import type { BoundingBox } from '@camera.ui/sdk';

/**
 * A point in normalized 0-1 space. Deliberately distinct from the SDK's
 * `Point`, which is the same tuple shape but expressed as 0-100 percentages —
 * mixing the two silently compiles and silently misbehaves.
 */
export type Vec2 = [number, number];

/**
 * Standard ray-casting test: count how many polygon edges a ray cast in the
 * +x direction from the point crosses. Odd means inside.
 *
 * Points exactly on a boundary are resolved by a half-open convention — the
 * left and bottom edges read as inside, the right and top edges as outside.
 * That keeps two zones sharing an edge from both claiming the same detection.
 */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    // Only edges that straddle the ray's y can be crossed by it.
    if (yi > py === yj > py) continue;
    const crossX = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < crossX) inside = !inside;
  }
  return inside;
}

/** The four corners of a box, in ring order. */
function corners(box: BoundingBox): Vec2[] {
  const { x, y, width, height } = box;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

function pointInBox([x, y]: Vec2, box: BoundingBox): boolean {
  return (
    x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
  );
}

/** Sign of the cross product — which side of ab the point c falls on. */
function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
}

/**
 * Proper segment intersection. Collinear and endpoint-touching cases return
 * false, which is what we want: a box whose edge lies exactly along a zone
 * edge should count as inside the zone, not as crossing out of it.
 */
function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  return (
    orientation(a1, a2, b1) !== orientation(a1, a2, b2) &&
    orientation(b1, b2, a1) !== orientation(b1, b2, a2)
  );
}

/** True if any edge of ring A properly crosses any edge of ring B. */
function ringsCross(ringA: Vec2[], ringB: Vec2[]): boolean {
  for (let i = 0; i < ringA.length; i++) {
    const a1 = ringA[i];
    const a2 = ringA[(i + 1) % ringA.length];
    for (let j = 0; j < ringB.length; j++) {
      const b1 = ringB[j];
      const b2 = ringB[(j + 1) % ringB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Overlap test. Three cases, and all three are needed: a box corner inside the
 * polygon, a polygon vertex inside the box (which covers a box that swallows
 * the polygon whole), or edges that cross with neither shape containing any of
 * the other's vertices (two crossed rectangles).
 */
export function boxIntersectsPolygon(
  box: BoundingBox,
  polygon: Vec2[],
): boolean {
  if (polygon.length < 3) return false;
  const boxRing = corners(box);
  if (boxRing.some((c) => pointInPolygon(c, polygon))) return true;
  if (polygon.some((p) => pointInBox(p, box))) return true;
  return ringsCross(boxRing, polygon);
}
