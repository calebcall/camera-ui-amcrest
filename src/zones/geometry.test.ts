import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boxInsidePolygon,
  boxIntersectsPolygon,
  pointInPolygon,
} from "./geometry.js";

import type { Vec2 } from "./geometry.js";

const SQUARE: Vec2[] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

const U_SHAPE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0.8, 1],
  [0.8, 0.3],
  [0.2, 0.3],
  [0.2, 1],
  [0, 1],
];

test("pointInPolygon: convex interior and exterior", () => {
  assert.equal(pointInPolygon([0.5, 0.5], SQUARE), true);
  assert.equal(pointInPolygon([0.9, 0.5], SQUARE), false);
  assert.equal(pointInPolygon([0.5, 0.1], SQUARE), false);
});

test("pointInPolygon: concave shapes exclude the notch", () => {
  assert.equal(pointInPolygon([0.5, 0.15], U_SHAPE), true, "bottom band");
  assert.equal(pointInPolygon([0.1, 0.6], U_SHAPE), true, "left arm");
  assert.equal(pointInPolygon([0.9, 0.6], U_SHAPE), true, "right arm");
  assert.equal(pointInPolygon([0.5, 0.6], U_SHAPE), false, "notch is outside");
});

// Boundary points are resolved by a half-open convention: the left and bottom
// edges count as inside, the right and top edges as outside. This is not
// arbitrary trivia — it is what stops two zones that share an edge from both
// claiming the same detection.
test("pointInPolygon: boundary points use a consistent half-open rule", () => {
  assert.equal(pointInPolygon([0.2, 0.5], SQUARE), true, "left edge");
  assert.equal(pointInPolygon([0.8, 0.5], SQUARE), false, "right edge");
  assert.equal(pointInPolygon([0.2, 0.2], SQUARE), true, "bottom-left vertex");
  assert.equal(pointInPolygon([0.8, 0.8], SQUARE), false, "top-right vertex");
});

test("boxIntersectsPolygon: box corner inside the polygon", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, SQUARE),
    true,
  );
});

test("boxIntersectsPolygon: box entirely containing the polygon", () => {
  // No box corner is inside the polygon and no box edge crosses it; this can
  // only be caught by testing whether a polygon vertex falls inside the box.
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0, width: 1, height: 1 }, SQUARE),
    true,
  );
});

test("boxIntersectsPolygon: crossing with neither shape containing the other's vertices", () => {
  // A tall thin polygon and a wide flat box forming a plus sign. Every box
  // corner is outside the polygon and every polygon vertex is outside the box,
  // so only an edge-crossing test finds this overlap. A corners-only
  // implementation returns false here.
  const TALL: Vec2[] = [
    [0.45, 0],
    [0.55, 0],
    [0.55, 1],
    [0.45, 1],
  ];
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0.45, width: 1, height: 0.1 }, TALL),
    true,
  );
});

test("boxIntersectsPolygon: disjoint", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0.85, y: 0.85, width: 0.1, height: 0.1 }, SQUARE),
    false,
  );
});

test("boxIntersectsPolygon: degenerate polygon never matches", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0, width: 1, height: 1 }, [
      [0, 0],
      [1, 1],
    ]),
    false,
  );
});

test("boxInsidePolygon: wholly inside a convex polygon", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, SQUARE),
    true,
  );
});

test("boxInsidePolygon: partial overlap is not containment", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, SQUARE),
    false,
  );
});

test("boxInsidePolygon: disjoint", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.85, y: 0.85, width: 0.1, height: 0.1 }, SQUARE),
    false,
  );
});

test("boxInsidePolygon: wholly inside a concave polygon", () => {
  // Sits in the U's bottom band, clear of the notch.
  assert.equal(
    boxInsidePolygon({ x: 0.4, y: 0.05, width: 0.2, height: 0.15 }, U_SHAPE),
    true,
  );
});

test("boxInsidePolygon: all corners inside but bulging through a concave notch", () => {
  // Spans the U's two arms at y 0.5-0.6. All four corners land inside an arm,
  // but the middle of the box crosses the notch, which is outside the polygon.
  // A corners-only implementation returns true here — it must be false.
  assert.equal(
    boxInsidePolygon({ x: 0.1, y: 0.5, width: 0.8, height: 0.1 }, U_SHAPE),
    false,
  );
});

test("boxInsidePolygon: degenerate polygon never contains", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, [
      [0, 0],
      [1, 1],
    ]),
    false,
  );
});
