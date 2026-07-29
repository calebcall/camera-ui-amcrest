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

  sensor.report("person", true, [
    { box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, trackId: 863 },
  ]);

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

  sensor.report("person", true, [
    { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  ]);
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

  sensor.report("person", true, [
    { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  ]);
  sensor.report("person", false);
  sensor.report("person", true);

  const last = calls[calls.length - 1];
  assert.deepEqual(last.detections[0].box, FULL_FRAME);
  assert.equal(last.detections[0].trackId, undefined);
});

test("a pulse activates the category and clears itself after the timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sensor = new AmcrestObjectSensor(5000);
  const calls = observe(sensor);

  sensor.pulse("person", [
    { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  ]);
  assert.equal(calls[0].active, true);
  assert.deepEqual(calls[0].detections[0].box, {
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
  });

  t.mock.timers.tick(4999);
  assert.equal(calls.length, 1, "must not clear before the timeout elapses");

  t.mock.timers.tick(1);
  assert.deepEqual(calls[1], { active: false, detections: [] });
});

test("a repeated pulse extends the active window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sensor = new AmcrestObjectSensor(5000);
  const calls = observe(sensor);

  sensor.pulse("person");
  t.mock.timers.tick(4000);
  sensor.pulse("person");
  t.mock.timers.tick(4000);

  assert.ok(
    calls.every((c) => c.active),
    "the second pulse must reset the expiry",
  );
  t.mock.timers.tick(1000);
  assert.equal(calls[calls.length - 1].active, false);
});

test("a pulse timeout does not clear a category held by Start", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sensor = new AmcrestObjectSensor(5000);
  const calls = observe(sensor);

  sensor.pulse("person");
  sensor.report("vehicle", true);
  t.mock.timers.tick(5000);

  const last = calls[calls.length - 1];
  assert.deepEqual(
    last.detections.map((d) => d.label),
    ["vehicle"],
  );
  assert.equal(last.active, true);
});

test("a Start after a pulse takes ownership of the category", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sensor = new AmcrestObjectSensor(5000);
  const calls = observe(sensor);

  sensor.pulse("person");
  sensor.report("person", true);
  t.mock.timers.tick(10_000);

  const last = calls[calls.length - 1];
  assert.equal(last.active, true, "Start/Stop owns the category after a Start");
  assert.deepEqual(
    last.detections.map((d) => d.label),
    ["person"],
  );
});

test("destroy cancels pending pulse timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sensor = new AmcrestObjectSensor(5000);
  const calls = observe(sensor);

  sensor.pulse("person");
  sensor.destroy();
  t.mock.timers.tick(10_000);

  assert.equal(calls.length, 1, "no report should fire after destroy");
});

test("a Stop for a never-activated category leaves other categories alone", () => {
  // Zone filtering can suppress a Start while its matching Stop still arrives.
  // The Stop must be harmless rather than clobbering an unrelated category.
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true);
  sensor.report("vehicle", false);

  const last = calls[calls.length - 1];
  assert.equal(last.active, true);
  assert.deepEqual(last.detections.map((d) => d.label), ["person"]);
});

test("reports one detection per object when an event carries several", () => {
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("vehicle", true, [
    { box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, trackId: 2 },
    { box: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, trackId: 3 },
  ]);

  assert.equal(calls[0].detections.length, 2);
  assert.deepEqual(
    calls[0].detections.map((d) => d.trackId),
    [2, 3],
  );
  assert.deepEqual(
    calls[0].detections.map((d) => d.label),
    ["vehicle", "vehicle"],
  );
});
