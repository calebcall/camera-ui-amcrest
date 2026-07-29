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
 * Runs once per zone-list change, not per event. Polygons with fewer than
 * three points cannot enclose anything, so they are dropped rather than
 * silently matching nothing later.
 */
export function compileZones(zones: DetectionZone[]): CompiledZone[] {
  return zones
    .filter((z) => Array.isArray(z.points) && z.points.length >= 3)
    .map((z) => ({
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
function describeBox(box: BoundingBox): string {
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
 * qualifies or disqualifies. A detection with no applicable zones is kept —
 * that is what makes this whole feature invisible to anyone who has not drawn
 * a zone, and why it needs no opt-in setting.
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

  const gates = applicable.filter((z) => !z.isPrivacyMask);
  if (gates.length === 0) return KEEP;

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
  // Fail open. Some firmware sends a bare Start with no payload; a terse
  // payload must never cost a real person detection.
  if (detections.length === 0) {
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
