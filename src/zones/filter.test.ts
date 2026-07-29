import assert from "node:assert/strict";
import { test } from "node:test";

import { compileZones, keepDetection } from "./filter.js";

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

const INSIDE = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
const PARTIAL = { x: 0.75, y: 0.75, width: 0.1, height: 0.1 };
const OUTSIDE = { x: 0.9, y: 0.9, width: 0.05, height: 0.05 };

test("keepDetection: no zones keeps everything", () => {
  assert.equal(keepDetection(OUTSIDE, "person", []).keep, true);
});

test("keepDetection: the four type x filter combinations", () => {
  const cases: {
    type: "intersect" | "contain";
    filter: "include" | "exclude";
    box: typeof INSIDE;
    expected: boolean;
    label: string;
  }[] = [
    { type: "intersect", filter: "include", box: INSIDE, expected: true, label: "include/intersect wholly inside" },
    { type: "intersect", filter: "include", box: PARTIAL, expected: true, label: "include/intersect overlapping" },
    { type: "intersect", filter: "include", box: OUTSIDE, expected: false, label: "include/intersect outside" },
    { type: "contain", filter: "include", box: INSIDE, expected: true, label: "include/contain wholly inside" },
    { type: "contain", filter: "include", box: PARTIAL, expected: false, label: "include/contain only overlapping" },
    { type: "contain", filter: "include", box: OUTSIDE, expected: false, label: "include/contain outside" },
    { type: "intersect", filter: "exclude", box: INSIDE, expected: false, label: "exclude/intersect wholly inside" },
    { type: "intersect", filter: "exclude", box: PARTIAL, expected: false, label: "exclude/intersect overlapping" },
    { type: "intersect", filter: "exclude", box: OUTSIDE, expected: true, label: "exclude/intersect outside" },
    { type: "contain", filter: "exclude", box: INSIDE, expected: false, label: "exclude/contain wholly inside" },
    { type: "contain", filter: "exclude", box: PARTIAL, expected: true, label: "exclude/contain only overlapping" },
    { type: "contain", filter: "exclude", box: OUTSIDE, expected: true, label: "exclude/contain outside" },
  ];

  for (const c of cases) {
    const zones = compileZones([zone({ type: c.type, filter: c.filter })]);
    assert.equal(keepDetection(c.box, "person", zones).keep, c.expected, c.label);
  }
});

test("keepDetection: a zone whose labels exclude this one is ignored entirely", () => {
  const zones = compileZones([zone({ labels: ["vehicle"] })]);
  // An include zone that does not apply to 'person' must not gate a person.
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, true);
  assert.equal(keepDetection(OUTSIDE, "vehicle", zones).keep, false);
});

test("keepDetection: empty labels applies the zone to every label", () => {
  const zones = compileZones([zone({ labels: [] })]);
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, false);
  assert.equal(keepDetection(OUTSIDE, "vehicle", zones).keep, false);
});

test("keepDetection: a privacy mask drops a detection an include zone would have kept", () => {
  const zones = compileZones([
    zone({ name: "Everything", points: [[0, 0], [100, 0], [100, 100], [0, 100]] }),
    zone({ name: "Bins", isPrivacyMask: true }),
  ]);
  const verdict = keepDetection(INSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(verdict.keep === false && verdict.reason, "inside privacy mask 'Bins'");
});

test("keepDetection: matching any one of several include zones is enough", () => {
  const zones = compileZones([
    zone({ name: "Corner", points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
    zone({ name: "Driveway" }),
  ]);
  assert.equal(keepDetection(INSIDE, "person", zones).keep, true);
});

test("keepDetection: with only exclude zones, not being excluded is enough", () => {
  const zones = compileZones([zone({ name: "Street", filter: "exclude" })]);
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, true);
  const verdict = keepDetection(INSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(verdict.keep === false && verdict.reason, "inside exclude zone 'Street'");
});

test("keepDetection: failing every include zone names them all", () => {
  const zones = compileZones([
    zone({ name: "Driveway" }),
    zone({ name: "Porch", points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  ]);
  const verdict = keepDetection(OUTSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "outside include zone(s) 'Driveway', 'Porch'",
  );
});
