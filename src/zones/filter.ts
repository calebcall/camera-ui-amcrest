import { boxInsidePolygon, boxIntersectsPolygon } from './geometry.js';

import type { Vec2 } from './geometry.js';
import type {
  AmcrestClassification,
  AmcrestDetection,
} from '../amcrest/classify.js';
import type {
  BoundingBox,
  DetectionLabel,
  DetectionZone,
  ZoneFilter,
  ZoneType,
} from '@camera.ui/sdk';

/** camera.ui stores zone polygons as 0-100 percentages; we work in 0-1. */
const ZONE_COORD_MAX = 100;

/** A `DetectionZone` normalized once, so per-event matching stays cheap. */
export interface CompiledZone {
  name: string;
  polygon: Vec2[];
  type: ZoneType;
  filter: ZoneFilter;
  /** Empty means the zone applies to every label. */
  labels: Set<DetectionLabel>;
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
function isDrawable(zone: DetectionZone): boolean {
  return (
    Array.isArray(zone.points) &&
    zone.points.length >= 3 &&
    zone.points.every((p) => isPoint(p))
  );
}

/**
 * Runs once per zone-list change, not per event. Unusable zones are dropped
 * rather than throwing: this runs inside a shared SDK property-change
 * subscriber, whose `Subject.next()` calls subscribers in a bare loop, so a
 * throw here would abort delivery to every other subscriber — and on the
 * seeding call in `initialize()` it would leave the camera offline and skip
 * every camera after it in the list.
 */
export function compileZones(zones: DetectionZone[]): CompiledZone[] {
  return zones.filter(isDrawable).map((z) => ({
    name: z.name,
    polygon: z.points.map(([x, y]): Vec2 => [
      x / ZONE_COORD_MAX,
      y / ZONE_COORD_MAX,
    ]),
    type: z.type,
    filter: z.filter,
    labels: new Set(z.labels ?? []),
    isPrivacyMask: z.isPrivacyMask,
  }));
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
 * Renders the box that was tested, so a suppression log says where the object
 * was and not merely which zone objected. Fixed precision on purpose: raw
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
 * Applies camera.ui's zone model to a single detection.
 *
 * `type` decides what "in the zone" means; `filter` decides whether being in it
 * qualifies or disqualifies.
 *
 * The subtle rule is what happens to a label no zone mentions, and it is not
 * the intuitive one. Drawing ANY gating zone switches the camera into
 * allow-listed mode: from then on a label that appears in no zone's label list
 * is dropped outright, not waved through. Only a camera with no gating zones at
 * all keeps everything, which is still what makes the feature invisible to
 * anyone who has not drawn one.
 *
 * This mirrors camera.ui's own rust zone filter, verified against it directly
 * rather than inferred. It matters because the two run side by side: the core
 * filters detections from its frame pipeline, this plugin filters the events
 * the camera reports, and the same zones must mean the same thing on both
 * paths. Until 1.8.0 this function returned "keep" for an unmentioned label —
 * so a camera whose zones listed only person reported packages through Amcrest
 * that the core silently dropped.
 *
 * Privacy masks are deliberately excluded from that test. A mask is a redaction,
 * not a gate, and a camera carrying nothing but privacy masks is not in
 * allow-listed mode — the core behaves the same way.
 */
export function keepDetection(
  box: BoundingBox,
  label: DetectionLabel,
  zones: CompiledZone[],
): ZoneVerdict {
  const applicable = zones.filter((z) => applies(z, label));

  // Privacy masks win outright: anything wholly inside one is dropped,
  // whatever that zone's own intersect/contain setting says.
  const mask = applicable.find(
    (z) => z.isPrivacyMask && boxInsidePolygon(box, z.polygon),
  );
  if (mask)
    return {
      keep: false,
      reason: `${describeBox(box)} inside privacy mask '${mask.name}'`,
    };

  // Gating zones for ANY label, which is what decides whether this camera is in
  // allow-listed mode at all — as opposed to `gates` below, which is the subset
  // that actually has an opinion about THIS label.
  const anyGates = zones.some((z) => !z.isPrivacyMask);
  const gates = applicable.filter((z) => !z.isPrivacyMask);

  if (gates.length === 0) {
    if (!anyGates) return KEEP;
    return {
      keep: false,
      reason: `${describeBox(box)} is a '${label}' and no zone lists that label`,
    };
  }

  const excluded = gates.find((z) => z.filter === 'exclude' && inZone(box, z));
  if (excluded) {
    return {
      keep: false,
      reason: `${describeBox(box)} inside exclude zone '${excluded.name}'`,
    };
  }

  const includes = gates.filter((z) => z.filter === 'include');
  if (includes.length === 0) return KEEP;
  if (includes.some((z) => inZone(box, z))) return KEEP;

  const names = includes.map((z) => `'${z.name}'`).join(', ');
  return {
    keep: false,
    reason: `${describeBox(box)} outside include zone(s) ${names}`,
  };
}

/**
 * What the caller should do with an object event.
 *
 * `skipped` still reports — it means the event bypassed zone filtering rather
 * than passing it, and carries why so the caller can say so once in the log.
 */
export type ZoneDecision =
  | { kind: 'report'; detections: AmcrestDetection[]; dropped: string[] }
  | {
    kind: 'skipped';
    detections: AmcrestDetection[];
    reason: 'deactivation' | 'no-coordinates';
  }
  | { kind: 'suppress'; reasons: string[] };

type ObjectClassification = Extract<AmcrestClassification, { kind: 'object' }>;

/** A box with no area pins the detection nowhere, so it carries no position. */
function hasCoordinates(detection: AmcrestDetection): boolean {
  // Magnitude, not sign: firmware is not obliged to send `[x1, y1, x2, y2]` the
  // right way round, and `geometry.ts` already normalizes a reversed rectangle.
  // Testing the raw values would classify a reversed-but-real box as having no
  // coordinates, which is the fail-open path rather than the zone test it
  // deserves. Only a genuinely zero-area box counts as carrying nothing.
  return (
    Math.abs(detection.box.width) > 0 && Math.abs(detection.box.height) > 0
  );
}

/**
 * True if any of these detections carries a usable position. Wraps the
 * per-detection test so callers outside this module can ask the same question
 * the gating path asks, rather than reimplementing it and drifting.
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

/**
 * Applies the camera's detection zones to a classified object event.
 *
 * Deactivations and coordinate-free activations deliberately bypass filtering;
 * see the inline notes. Everything else is filtered per detection, and an event
 * whose detections are all dropped is suppressed outright rather than reported
 * as an empty activation.
 */
export function decideObjectEvent(
  c: ObjectClassification,
  zones: CompiledZone[],
): ZoneDecision {
  // A Stop carries no boxes, so it can never satisfy a zone. Filtering it would
  // suppress it, and the sensor would stay latched active forever.
  if (!c.active) {
    return {
      kind: 'skipped',
      detections: c.detections ?? [],
      reason: 'deactivation',
    };
  }

  const detections = c.detections ?? [];
  // Fail open. Some firmware sends a bare Start with no payload and some sends
  // a placeholder Rect of [0,0,0,0]; both mean "no position", and a terse
  // payload must never cost a real person detection. A zero-area box would
  // otherwise fail every include zone and be suppressed.
  if (!hasUsableCoordinates(detections)) {
    return { kind: 'skipped', detections, reason: 'no-coordinates' };
  }

  const kept: AmcrestDetection[] = [];
  const dropped: string[] = [];
  for (const detection of detections) {
    const verdict = keepDetection(detection.box, c.category, zones);
    if (verdict.keep) kept.push(detection);
    else dropped.push(verdict.reason);
  }

  if (kept.length === 0) return { kind: 'suppress', reasons: dropped };
  return { kind: 'report', detections: kept, dropped };
}
