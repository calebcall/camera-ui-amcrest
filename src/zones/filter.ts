import { boxInsidePolygon, boxIntersectsPolygon } from './geometry.js';

import type { Vec2 } from './geometry.js';
import type {
  AmcrestClassification,
  AmcrestDetection,
} from '../amcrest/classify.js';
import type {
  BoundingBox,
  CameraZones,
  DetectionLabel,
  ObjectZone,
  Point,
  PrivacyZone,
  ZoneLabel,
  ZoneType,
} from '@camera.ui/sdk';

/** camera.ui stores zone polygons as 0-100 percentages; we work in 0-1. */
const ZONE_COORD_MAX = 100;

/**
 * One zone from `CameraZones` normalized into 0-1 space, so per-event matching
 * stays cheap.
 *
 * The SDK models object zones and privacy zones as separate shapes, but they
 * are decided against the same box in the same pass, so they compile to one
 * type here. `isPrivacyMask` is what tells them apart afterwards.
 */
export interface CompiledZone {
  name: string;
  polygon: Vec2[];
  type: ZoneType;
  /** Empty means the zone applies to every label. Always empty for a mask. */
  labels: Set<ZoneLabel>;
  isPrivacyMask: boolean;
}

/**
 * A well-formed `[x, y]` pair. Typed `unknown` rather than `Point` because the
 * SDK's own type is not a guarantee here — the data crosses a process boundary.
 */
function isPoint(point: unknown): point is [number, number] {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

/**
 * A zone that can actually be projected into 0-1 space. Polygons with fewer
 * than three points cannot enclose anything, and malformed points cannot be
 * divided at all.
 */
function isDrawable(points: Point[] | undefined): boolean {
  return (
    Array.isArray(points) && points.length >= 3 && points.every((p) => isPoint(p))
  );
}

function toPolygon(points: Point[]): Vec2[] {
  return points.map(([x, y]): Vec2 => [x / ZONE_COORD_MAX, y / ZONE_COORD_MAX]);
}

/**
 * Compiles the camera's zones into the flat list the matcher walks.
 *
 * Mirrors the server's own normalization (`toRustZones` in
 * `camera/decoder/detection-pipeline.js`), so what this plugin says about a box
 * matches what camera.ui will do with it:
 *
 * - `privacy` zones become masks, matched by intersection, and only when they
 *   drop detections — a privacy zone that merely hides the picture leaves the
 *   detector watching.
 * - `object` zones become include gates keeping their own `type` and labels.
 * - `alert` zones are deliberately absent: they never filter, they only decide
 *   which detections may raise a push notification.
 * - `motion` zones are absent too. They scope the `motion` label alone, and
 *   this plugin's motion events (`VideoMotion`) carry no coordinates to test.
 * - `lines` are events in their own right, handled in `classify.ts`.
 *
 * Runs once per zone-list change, not per event. Unusable zones are dropped
 * rather than throwing: this runs inside a shared SDK property-change
 * subscriber, whose `Subject.next()` calls subscribers in a bare loop, so a
 * throw here would abort delivery to every other subscriber — and on the
 * seeding call in `initialize()` it would leave the camera offline and skip
 * every camera after it in the list.
 */
export function compileZones(zones: CameraZones | undefined): CompiledZone[] {
  const privacy: PrivacyZone[] = zones?.privacy ?? [];
  const object: ObjectZone[] = zones?.object ?? [];

  const masks = privacy
    .filter((z) => z.dropDetections !== false && isDrawable(z.points))
    .map(
      (z): CompiledZone => ({
        name: z.name,
        polygon: toPolygon(z.points),
        type: 'intersect',
        labels: new Set<ZoneLabel>(),
        isPrivacyMask: true,
      }),
    );

  const gates = object.filter((z) => isDrawable(z.points)).map(
    (z): CompiledZone => ({
      name: z.name,
      polygon: toPolygon(z.points),
      type: z.type,
      labels: new Set<ZoneLabel>(z.labels ?? []),
      isPrivacyMask: false,
    }),
  );

  return [...masks, ...gates];
}

/**
 * Why a detection was dropped. The `reason` is a finished, human-readable
 * phrase rather than structured data: it is built here, where the zone name is
 * in scope, and consumed verbatim by the caller's logger. That keeps this
 * module free of logging and the caller free of zone vocabulary.
 */
export type ZoneVerdict = { keep: true } | { keep: false; reason: string };

const KEEP: ZoneVerdict = { keep: true };

/** Decimal places in a logged box — enough to locate it, short enough to read. */
const BOX_LOG_PRECISION = 2;

/**
 * Renders the box that was tested, so a rejection log says where the object was
 * and not merely which zone objected. Fixed precision on purpose: raw
 * floats print as 0.7100000000000001 and make the line unreadable.
 */
export function describeBox(box: BoundingBox): string {
  const n = (v: number): string => v.toFixed(BOX_LOG_PRECISION);
  return `box [${n(box.x)},${n(box.y)},${n(box.width)},${n(box.height)}]`;
}

function applies(zone: CompiledZone, label: DetectionLabel): boolean {
  return zone.labels.size === 0 || zone.labels.has(label);
}

/** What "in the zone" means for this zone — its `type` decides. */
function inZone(box: BoundingBox, zone: CompiledZone): boolean {
  return zone.type === 'contain'
    ? boxInsidePolygon(box, zone.polygon)
    : boxIntersectsPolygon(box, zone.polygon);
}

/**
 * The labels the object zones restrict detection to, or null when they do not
 * restrict at all.
 *
 * Mirrors the server's `objectWhitelist`: once every object zone names its
 * labels, a label none of them names is not watched anywhere, so it is dropped
 * wherever it appears rather than merely gated on position. A single zone that
 * lists no labels means the zones constrain *where* every label counts, not
 * *which* labels count, and the whitelist is off.
 *
 * Recomputed per detection rather than cached with the compiled list: a camera
 * has a handful of zones and an event a handful of boxes, and threading a
 * second value through every call site buys nothing at that size.
 */
function labelWhitelist(gates: CompiledZone[]): Set<ZoneLabel> | null {
  if (gates.length === 0) return null;
  if (gates.some((zone) => zone.labels.size === 0)) return null;
  const labels = new Set<ZoneLabel>();
  for (const zone of gates) for (const label of zone.labels) labels.add(label);
  return labels;
}

/**
 * Applies camera.ui's zone model to a single detection.
 *
 * Object zones are include gates — the SDK has no exclude mode any more, that
 * role belongs to privacy zones. `type` decides what "in the zone" means. A
 * detection with no applicable zones is kept — that is what makes this whole
 * feature invisible to anyone who has not drawn a zone, and why it needs no
 * opt-in setting.
 */
export function keepDetection(
  box: BoundingBox,
  label: DetectionLabel,
  zones: CompiledZone[],
): ZoneVerdict {
  // Privacy masks win outright: anything wholly inside one is dropped. They
  // carry no labels, so they apply to every detection.
  const mask = zones.find(
    (z) => z.isPrivacyMask && boxInsidePolygon(box, z.polygon),
  );
  if (mask)
    return {
      keep: false,
      reason: `${describeBox(box)} inside privacy mask '${mask.name}'`,
    };

  const gates = zones.filter((z) => !z.isPrivacyMask);
  if (gates.length === 0) return KEEP;

  // A label no object zone names is not watched anywhere, so where the box sits
  // is not the question.
  const whitelist = labelWhitelist(gates);
  if (whitelist && !whitelist.has(label)) {
    const names = [...whitelist].map((l) => `'${l}'`).join(', ');
    return {
      keep: false,
      reason: `label '${label}' is in no object zone (zones watch ${names})`,
    };
  }

  const applicable = gates.filter((z) => applies(z, label));
  if (applicable.length === 0) return KEEP;
  if (applicable.some((z) => inZone(box, z))) return KEEP;

  const names = applicable.map((z) => `'${z.name}'`).join(', ');
  return {
    keep: false,
    reason: `${describeBox(box)} outside object zone(s) ${names}`,
  };
}

/**
 * What the camera's zones make of an object event.
 *
 * Observation only. camera.ui applies these same zones to every detection a
 * camera-side sensor reports (`applyExternalDetectionFilters` in
 * `camera/decoder/detection-coordinator.js`), so the plugin filtering as well
 * would be the same rule run twice — and the plugin's copy is the weaker of the
 * two: it judges the single coarse box the camera sent, while the host judges
 * the tracked and optionally assist-refined box. Worse, a detection the plugin
 * withholds is one the host never sees at all, which costs the PTZ
 * autotracker's presence feed, the object-assist re-filter and the detection
 * record.
 *
 * So the verdict is reported rather than enforced. It exists because a zone
 * that quietly drops everything looks exactly like a camera that never fires
 * (#27), and because the camera's one-position-per-event limitation is only
 * visible from here (#26).
 */
export type ZoneReview =
  /** Nothing drawn, so there is nothing to say. */
  | { kind: 'no-zones' }
  /**
   * A Stop. Its boxes describe where the object left, not where it was seen, so
   * the zones have no claim on it — but it is the only chance to find out where
   * a rejected object ended up. See reviewSuppressedStart in camera.ts.
   */
  | { kind: 'deactivation'; detections: AmcrestDetection[] }
  /** No usable position, so no zone can judge it either way. */
  | { kind: 'no-coordinates'; detections: AmcrestDetection[] }
  /** Every detection is somewhere the zones accept. */
  | { kind: 'pass'; detections: AmcrestDetection[] }
  /** Some are, some are not. */
  | { kind: 'partial'; kept: AmcrestDetection[]; dropped: string[] }
  /** None are. This is the case camera.ui will act on by dropping the event. */
  | { kind: 'fail'; reasons: string[] };

type ObjectClassification = Extract<AmcrestClassification, { kind: 'object' }>;

/** A box with no area pins the detection nowhere, so it carries no position. */
function hasCoordinates(detection: AmcrestDetection): boolean {
  // Magnitude, not sign: firmware is not obliged to send `[x1, y1, x2, y2]` the
  // right way round, and `geometry.ts` already normalizes a reversed rectangle.
  // Testing the raw values would classify a reversed-but-real box as having no
  // coordinates, which would claim a zone could not judge a box it can.
  return (
    Math.abs(detection.box.width) > 0 && Math.abs(detection.box.height) > 0
  );
}

/**
 * True if any of these detections carries a usable position. Wraps the
 * per-detection test so callers outside this module can ask the same question
 * the review asks, rather than reimplementing it and drifting.
 */
export function hasUsableCoordinates(detections: AmcrestDetection[]): boolean {
  return detections.some(hasCoordinates);
}

/**
 * The first detection these zones would keep, or undefined if none would.
 *
 * Returns the detection rather than a boolean so a caller can name the box that
 * qualified — the walk-in log line in `camera.ts` reports it.
 */
export function findKeptDetection(
  detections: AmcrestDetection[],
  label: DetectionLabel,
  zones: CompiledZone[],
): AmcrestDetection | undefined {
  return detections.find((d) => keepDetection(d.box, label, zones).keep);
}

/** Measures a classified object event against the camera's zones. */
export function reviewObjectEvent(
  c: ObjectClassification,
  zones: CompiledZone[],
): ZoneReview {
  const detections = c.detections ?? [];

  if (zones.length === 0) return { kind: 'no-zones' };
  if (!c.active) return { kind: 'deactivation', detections };
  if (!hasUsableCoordinates(detections)) {
    return { kind: 'no-coordinates', detections };
  }

  const kept: AmcrestDetection[] = [];
  const dropped: string[] = [];
  for (const detection of detections) {
    const verdict = keepDetection(detection.box, c.category, zones);
    if (verdict.keep) kept.push(detection);
    else dropped.push(verdict.reason);
  }

  if (kept.length === 0) return { kind: 'fail', reasons: dropped };
  if (dropped.length > 0) return { kind: 'partial', kept, dropped };
  return { kind: 'pass', detections: kept };
}
