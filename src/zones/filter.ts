import { boxInsidePolygon, boxIntersectsPolygon } from './geometry.js';

import type { Vec2 } from './geometry.js';
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
      polygon: z.points.map(
        ([x, y]): Vec2 => [x / ZONE_COORD_MAX, y / ZONE_COORD_MAX],
      ),
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
  if (mask) return { keep: false, reason: `inside privacy mask '${mask.name}'` };

  const gates = applicable.filter((z) => !z.isPrivacyMask);
  if (gates.length === 0) return KEEP;

  const excluded = gates.find((z) => z.filter === 'exclude' && inZone(box, z));
  if (excluded) {
    return { keep: false, reason: `inside exclude zone '${excluded.name}'` };
  }

  const includes = gates.filter((z) => z.filter === 'include');
  if (includes.length === 0) return KEEP;
  if (includes.some((z) => inZone(box, z))) return KEEP;

  const names = includes.map((z) => `'${z.name}'`).join(', ');
  return { keep: false, reason: `outside include zone(s) ${names}` };
}
