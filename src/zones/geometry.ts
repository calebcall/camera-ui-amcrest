import type { BoundingBox } from '@camera.ui/sdk';

/**
 * A point in normalized 0-1 space. Deliberately distinct from the SDK's
 * `Point`, which is the same tuple shape but expressed as 0-100 percentages —
 * mixing the two silently compiles and silently misbehaves.
 */
export type Vec2 = [number, number];

/**
 * Tolerance for the on-boundary test. These coordinates arrive from division
 * (0-8191 and 0-100 both normalize into 0-1), so exact equality is too brittle
 * to decide whether a point sits on an edge.
 */
const BOUNDARY_EPSILON = 1e-9;

/**
 * Standard ray-casting test: count how many polygon edges a ray cast in the
 * +x direction from the point crosses. Odd means inside.
 *
 * Points exactly on a boundary are resolved by a half-open convention — the
 * left and top edges read as inside, the right and bottom edges as outside
 * (y grows downward in image space, so the smaller y is the top). All that
 * buys is a total, deterministic answer for a bare point; it decides nothing
 * about boxes, whose other corners settle the boundary case on their own.
 * The box tests below handle the boundary explicitly rather than relying on it.
 */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    // Only edges that straddle the ray's y can be crossed by it.
    const iAbove = yi > py;
    const jAbove = yj > py;
    if (iAbove === jAbove) continue;
    const crossX = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < crossX) inside = !inside;
  }
  return inside;
}

/**
 * A box's extents with any negative width/height flipped. Firmware is not
 * required to send `[x1, y1, x2, y2]` the right way round, and a reversed
 * rectangle would otherwise make every `x >= min && x <= max` test
 * unsatisfiable, silently disabling the "polygon vertex inside the box" branch.
 */
function extents(box: BoundingBox): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const { x, y, width, height } = box;
  return {
    minX: Math.min(x, x + width),
    minY: Math.min(y, y + height),
    maxX: Math.max(x, x + width),
    maxY: Math.max(y, y + height),
  };
}

/** The four corners of a box, in ring order. */
function corners(box: BoundingBox): Vec2[] {
  const { minX, minY, maxX, maxY } = extents(box);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

function pointInBox([x, y]: Vec2, box: BoundingBox): boolean {
  const { minX, minY, maxX, maxY } = extents(box);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Strictly inside — the box's open interior, edges excluded. Deliberately not
 * `pointInBox`: a box flush against a zone edge has that zone's vertices sitting
 * exactly on its own edge, and treating those as interior would undo the
 * frame-edge containment fix.
 *
 * The margin is what makes that true in practice rather than only in principle.
 * Callers reconstruct the point by arithmetic (`a + d * t`), which lands a few
 * ulps off the face it should sit exactly on — `0.7 + (-0.6)` is
 * 0.09999999999999998, not 0.1. An exact comparison reads that as interior and
 * concludes a zone wall passes through a box it merely touches.
 */
function pointStrictlyInBox([x, y]: Vec2, box: BoundingBox): boolean {
  const { minX, minY, maxX, maxY } = extents(box);
  return (
    x > minX + BOUNDARY_EPSILON &&
    x < maxX - BOUNDARY_EPSILON &&
    y > minY + BOUNDARY_EPSILON &&
    y < maxY - BOUNDARY_EPSILON
  );
}

/**
 * True if any part of segment ab passes through the box's open interior.
 *
 * Liang-Barsky clips the segment to the closed box, then the midpoint of what
 * survives decides. That midpoint is exact for an axis-aligned box: if the
 * clipped part lay flat against a face, both its endpoints would share that
 * face's coordinate and so would the midpoint, so a midpoint in the interior
 * means the segment genuinely runs through the box rather than along it.
 */
function segmentEntersBox(a: Vec2, b: Vec2, box: BoundingBox): boolean {
  const { minX, minY, maxX, maxY } = extents(box);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const limits: [number, number][] = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ];

  let enter = 0;
  let exit = 1;
  for (const [rate, room] of limits) {
    if (rate === 0) {
      // Parallel to this face: either always within it, or never.
      if (room < 0) return false;
      continue;
    }
    const t = room / rate;
    if (rate < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }

  const mid = (enter + exit) / 2;
  return pointStrictlyInBox([a[0] + dx * mid, a[1] + dy * mid], box);
}

/**
 * True if the point lies on the polygon's outline, within `BOUNDARY_EPSILON`.
 *
 * Containment needs this because `pointInPolygon`'s half-open rule calls two of
 * the four sides "outside", and the frame edge is exactly where that bites: an
 * object clipped at the edge of frame normalizes to exactly 1.0, and so does a
 * zone drawn to that edge. Without an inclusive test, a full-frame privacy mask
 * fails to mask the person standing at the bottom of the picture.
 */
function pointOnPolygonBoundary(point: Vec2, polygon: Vec2[]): boolean {
  const [px, py] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const cross = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
    if (Math.abs(cross) > BOUNDARY_EPSILON) continue;
    // Collinear with the edge's infinite line; the segment's own span decides.
    const withinX =
      px >= Math.min(xi, xj) - BOUNDARY_EPSILON &&
      px <= Math.max(xi, xj) + BOUNDARY_EPSILON;
    const withinY =
      py >= Math.min(yi, yj) - BOUNDARY_EPSILON &&
      py <= Math.max(yi, yj) + BOUNDARY_EPSILON;
    if (withinX && withinY) return true;
  }
  return false;
}

/** Sign of the cross product — which side of ab the point c falls on. */
function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
}

/**
 * Segment intersection. Fully collinear segments return false, but a T-junction
 * — one segment's endpoint landing on the other — counts, which is the right
 * answer for an overlap test: touching is touching.
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

/** The box's midpoint, normalized extents so a reversed box still works. */
function centre(box: BoundingBox): Vec2 {
  const { minX, minY, maxX, maxY } = extents(box);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Containment test, boundary-inclusive: a box flush against the polygon's
 * outline counts as inside. That matters because both sides of the comparison
 * saturate at the frame edge — a clipped detection and a zone drawn to the edge
 * of the picture both normalize to exactly 1.0 — so a half-open answer there
 * would let a full-frame privacy mask miss the object it exists to hide.
 *
 * Two conditions, and together they are exact:
 *
 * 1. No part of the polygon's outline passes through the box's interior. A box
 *    genuinely inside the polygon cannot have the polygon's own boundary
 *    running through it — that boundary is where the polygon stops. This
 *    subsumes both "a corner is outside" and "an edge crosses", including the
 *    concave case where all four corners sit inside but the box bulges out
 *    through a notch and back in.
 * 2. Given (1), the box's interior meets the polygon's boundary nowhere, so it
 *    lies wholly inside or wholly outside and a single point settles which.
 *    The centre is that point.
 *
 * The corner check stays as a fast rejection, and it is what decides a box with
 * no area, whose empty interior makes (1) vacuous and (2) a bare point test.
 */
export function boxInsidePolygon(box: BoundingBox, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;

  const enclosed = (p: Vec2): boolean =>
    pointInPolygon(p, polygon) || pointOnPolygonBoundary(p, polygon);
  if (!corners(box).every(enclosed)) return false;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (segmentEntersBox(a, b, box)) return false;
  }

  // Distinguishes a box inside the polygon from a box wedged exactly inside a
  // notch that is outside it — flush against both walls, so nothing above fires.
  return enclosed(centre(box));
}
