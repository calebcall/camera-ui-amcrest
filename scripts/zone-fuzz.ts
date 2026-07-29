/**
 * Differential fuzz for zone containment: `boxInsidePolygon` against a
 * dense-sampling ground truth, over U-shaped, plus-shaped and full-frame
 * polygons.
 *
 * Two coordinate regimes matter and both are covered. A coarse 0.1 grid
 * manufactures the exact collinearity that unit tests rarely hit, and
 * `k / 8191` reproduces what the camera actually sends, saturating at 0 and 1
 * the way a clipped detection does. Those saturating cases are where the
 * containment bugs lived: the unit suite was fully green while this harness
 * found 27 false negatives.
 *
 * Run: npm run zone-fuzz
 */
import { boxInsidePolygon, boxIntersectsPolygon, pointInPolygon } from '../src/zones/geometry.js';

import type { Vec2 } from '../src/zones/geometry.js';

let seed = 20260729;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function onBoundary(p: Vec2, poly: Vec2[]): boolean {
  const [px, py] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const cross = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
    if (Math.abs(cross) > 1e-9) continue;
    if (px < Math.min(xi, xj) - 1e-9 || px > Math.max(xi, xj) + 1e-9) continue;
    if (py < Math.min(yi, yj) - 1e-9 || py > Math.max(yi, yj) + 1e-9) continue;
    return true;
  }
  return false;
}
function inClosed(p: Vec2, poly: Vec2[]): boolean {
  return pointInPolygon(p, poly) || onBoundary(p, poly);
}

/** Dense sampling ground truth, with a margin so boundary-grazing is not counted against us. */
function sampledInside(box: { x: number; y: number; width: number; height: number }, poly: Vec2[]): boolean {
  const N = 40;
  let outside = 0;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p: Vec2 = [box.x + (box.width * i) / N, box.y + (box.height * j) / N];
      if (!inClosed(p, poly)) outside++;
    }
  }
  return outside === 0;
}

function uShape(notchY: number, left: number, right: number): Vec2[] {
  return [[0, 0], [1, 0], [1, 1], [right, 1], [right, notchY], [left, notchY], [left, 1], [0, 1]];
}
function plusShape(): Vec2[] {
  return [[0.3, 0], [0.7, 0], [0.7, 0.3], [1, 0.3], [1, 0.7], [0.7, 0.7], [0.7, 1], [0.3, 1], [0.3, 0.7], [0, 0.7], [0, 0.3], [0.3, 0.3]];
}
function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

let falsePos = 0;
let falseNeg = 0;
let checked = 0;
let contained = 0;

// Two coordinate regimes: a coarse 0.1 grid (manufactures exact collinearity)
// and realistic camera coordinates (k/8191, saturating at 0 and 1).
function coord(coarse: boolean): number {
  if (coarse) return Math.round(rnd() * 10) / 10;
  const v = Math.round(rnd() * 9500) / 8191;
  return Math.min(1, v);
}

for (let t = 0; t < 120000; t++) {
  const coarse = t % 2 === 0;
  const shape = t % 3;
  const poly =
    shape === 0
      ? uShape(Math.round(rnd() * 8 + 1) / 10, Math.round(rnd() * 4) / 10, Math.round(rnd() * 4 + 6) / 10)
      : shape === 1
        ? plusShape()
        : rect(0, 0, 1, 1);

  const x = coord(coarse);
  const y = coord(coarse);
  const w = coord(coarse) * (1 - x);
  const h = coord(coarse) * (1 - y);
  if (w <= 0 || h <= 0) continue;
  const box = { x, y, width: w, height: h };
  checked++;

  const head = boxInsidePolygon(box, poly);
  const truth = sampledInside(box, poly);
  if (head) contained++;

  if (head && !truth) {
    falsePos++;
    if (falsePos <= 3) console.log('FALSE POSITIVE', JSON.stringify({ box, poly }));
  }
  if (!head && truth) {
    falseNeg++;
    if (falseNeg <= 3) console.log('FALSE NEGATIVE', JSON.stringify({ box, poly }));
  }
  if (head && !boxIntersectsPolygon(box, poly)) {
    console.log('CONTAINED BUT NOT INTERSECTING', JSON.stringify({ box, poly }));
  }
}

console.log(`checked=${checked} reportedContained=${contained} falsePositives=${falsePos} falseNegatives=${falseNeg}`);
