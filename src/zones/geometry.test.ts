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

const FULL_FRAME: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
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

// Boundary points are resolved by a half-open convention: the left and top
// edges count as inside, the right and bottom edges as outside (y grows
// downward in image space, so the smaller y is the top). It only gives a bare
// point a deterministic answer — boxInsidePolygon deliberately overrides it,
// because a box flush against a zone edge is inside that zone.
test("pointInPolygon: boundary points use a consistent half-open rule", () => {
  assert.equal(pointInPolygon([0.2, 0.5], SQUARE), true, "left edge");
  assert.equal(pointInPolygon([0.8, 0.5], SQUARE), false, "right edge");
  assert.equal(pointInPolygon([0.2, 0.2], SQUARE), true, "top-left vertex");
  assert.equal(
    pointInPolygon([0.8, 0.8], SQUARE),
    false,
    "bottom-right vertex",
  );
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

test("boxIntersectsPolygon: a reversed box still swallows the polygon", () => {
  // Firmware is not obliged to send Rect the right way round. Expressed with
  // negative extents, this is the same 0-1 box as the test above, and the only
  // branch that can find the overlap is "polygon vertex inside the box" — which
  // an unnormalized `x >= box.x && x <= box.x + box.width` can never satisfy.
  assert.equal(
    boxIntersectsPolygon({ x: 1, y: 1, width: -1, height: -1 }, SQUARE),
    true,
  );
});

test("boxInsidePolygon: a reversed box is still contained", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.5, y: 0.5, width: -0.2, height: -0.2 }, SQUARE),
    true,
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

// A detection clipped at the edge of frame normalizes to exactly 1.0, and a
// zone drawn to the edge of the picture compiles to exactly 1.0 too. If
// containment were half-open on those sides, a full-frame zone would fail to
// contain the object standing at the edge of it.
test("boxInsidePolygon: a box flush against the bottom of frame is inside a full-frame zone", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.3, y: 0.55, width: 0.4, height: 0.45 }, FULL_FRAME),
    true,
  );
});

test("boxInsidePolygon: a box flush against the right of frame is inside a full-frame zone", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.6, y: 0.2, width: 0.4, height: 0.3 }, FULL_FRAME),
    true,
  );
});

test("boxInsidePolygon: a box filling the frame exactly is inside a full-frame zone", () => {
  assert.equal(
    boxInsidePolygon({ x: 0, y: 0, width: 1, height: 1 }, FULL_FRAME),
    true,
  );
});

test("boxInsidePolygon: sharing an edge is not enough when the box lies outside it", () => {
  // Sits directly below the frame, touching only along y = 1.
  assert.equal(
    boxInsidePolygon({ x: 0.3, y: 1, width: 0.4, height: 0.2 }, FULL_FRAME),
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
