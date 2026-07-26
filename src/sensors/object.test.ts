import assert from "node:assert/strict";
import { test } from "node:test";

import { AmcrestObjectSensor } from "./object.js";

import type { TrackedDetection } from "@camera.ui/sdk";

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

interface Call {
  active: boolean;
  detections: TrackedDetection[];
}

function observe(sensor: AmcrestObjectSensor): Call[] {
  const calls: Call[] = [];
  // Override the SDK method to observe calls.
  (
    sensor as unknown as {
      reportDetections: (active: boolean, dets?: TrackedDetection[]) => void;
    }
  ).reportDetections = (active, dets) => {
    calls.push({ active, detections: dets ?? [] });
  };
  return calls;
}

test("tracks active categories and reports full-frame detections", () => {
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true);
  sensor.report("vehicle", true);
  sensor.report("person", false);
  sensor.report("vehicle", false);

  assert.deepEqual(
    calls.map((c) => ({
      active: c.active,
      labels: c.detections.map((d) => d.label),
    })),
    [
      { active: true, labels: ["person"] },
      { active: true, labels: ["person", "vehicle"] },
      { active: true, labels: ["vehicle"] },
      { active: false, labels: [] },
    ],
  );
  assert.deepEqual(calls[0].detections[0].box, FULL_FRAME);
});

test("reports the payload box and track id when the event supplies one", () => {
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true, {
    box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    trackId: 863,
  });

  assert.deepEqual(calls[0].detections, [
    {
      label: "person",
      confidence: 1,
      box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      trackId: 863,
    },
  ]);
});

test("keeps each category's own box when several are active", () => {
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true, {
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  });
  sensor.report("vehicle", true);

  assert.deepEqual(calls[1].detections[0].box, {
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
  });
  assert.deepEqual(calls[1].detections[1].box, FULL_FRAME);
});

test("forgets a stale box once the category clears and returns without one", () => {
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true, {
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  });
  sensor.report("person", false);
  sensor.report("person", true);

  const last = calls[calls.length - 1];
  assert.deepEqual(last.detections[0].box, FULL_FRAME);
  assert.equal(last.detections[0].trackId, undefined);
});
