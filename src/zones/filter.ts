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
