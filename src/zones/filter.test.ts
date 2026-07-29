import assert from "node:assert/strict";
import { test } from "node:test";

import { compileZones } from "./filter.js";

import type { DetectionZone } from "@camera.ui/sdk";

/** A 0.2-0.8 square once compiled. Override any field per test. */
function zone(overrides: Partial<DetectionZone> = {}): DetectionZone {
  return {
    name: "Zone",
    points: [
      [20, 20],
      [80, 20],
      [80, 80],
      [20, 80],
    ],
    type: "intersect",
    filter: "include",
    labels: [],
    isPrivacyMask: false,
    color: "#ffffff",
    ...overrides,
  };
}

test("compileZones scales 0-100 percentages into 0-1 space", () => {
  const [compiled] = compileZones([zone()]);
  assert.deepEqual(compiled.polygon, [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ]);
  assert.equal(compiled.name, "Zone");
  assert.equal(compiled.type, "intersect");
  assert.equal(compiled.filter, "include");
  assert.equal(compiled.isPrivacyMask, false);
  assert.deepEqual([...compiled.labels], []);
});

test("compileZones drops polygons with fewer than three points", () => {
  const kept = compileZones([
    zone({ name: "Line", points: [[0, 0], [100, 100]] }),
    zone({ name: "Real" }),
  ]);
  assert.deepEqual(kept.map((z) => z.name), ["Real"]);
});

test("compileZones handles an empty list", () => {
  assert.deepEqual(compileZones([]), []);
});

test("compileZones carries labels into a Set", () => {
  const [compiled] = compileZones([zone({ labels: ["person", "vehicle"] })]);
  assert.equal(compiled.labels.has("person"), true);
  assert.equal(compiled.labels.has("vehicle"), true);
  assert.equal(compiled.labels.has("animal"), false);
});
