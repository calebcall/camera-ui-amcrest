import assert from "node:assert/strict";
import { test } from "node:test";

import { pointInPolygon } from "./geometry.js";

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
