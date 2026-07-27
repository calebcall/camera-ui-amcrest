import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classifyAmcrestEvent } from "./classify.js";
import { parseAmcrestEvent } from "./events.js";

import type { AmcrestDetection } from "./classify.js";

function assertClose(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `expected ${actual} to be within 1e-6 of ${expected}`,
  );
}

test("classifies motion start/stop", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "VideoMotion", action: "Start" }),
    { kind: "motion", active: true },
  );
  assert.deepEqual(
    classifyAmcrestEvent({ code: "VideoMotion", action: "Stop" }),
    { kind: "motion", active: false },
  );
});

test("classifies audio mutation", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "AudioMutation", action: "Start" }),
    { kind: "audio", active: true },
  );
});

test("classifies smart human and vehicle", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "SmartMotionHuman", action: "Start" }),
    { kind: "object", category: "person", active: true },
  );
  assert.deepEqual(classifyAmcrestEvent({ code: "Vehicle", action: "Start" }), {
    kind: "object",
    category: "vehicle",
    active: true,
  });
});

test("classifies cross-region by ObjectType", () => {
  const ev = {
    code: "CrossRegionDetection",
    action: "Start",
    data: { Object: { ObjectType: "Human" } },
  };
  assert.deepEqual(classifyAmcrestEvent(ev), {
    kind: "object",
    category: "person",
    active: true,
  });
});

test("converts the Dahua 0-8191 bounding box to a normalized box", () => {
  const ev = {
    code: "CrossRegionDetection",
    action: "Start",
    data: {
      Object: {
        ObjectType: "Human",
        BoundingBox: [2856, 1280, 3880, 4880],
        ObjectID: 863,
      },
    },
  };
  const c = classifyAmcrestEvent(ev);
  assert.equal(c?.kind, "object");
  const detection = (c as { detection?: AmcrestDetection }).detection;
  assert.ok(detection, "expected a detection derived from the payload");
  assert.equal(detection.trackId, 863);
  assertClose(detection.box.x, 0.348675375);
  assertClose(detection.box.y, 0.156269076);
  assertClose(detection.box.width, 0.125015261);
  assertClose(detection.box.height, 0.439506776);
});

test("clamps bounding boxes that overshoot the coordinate space", () => {
  const ev = {
    code: "CrossLineDetection",
    action: "Start",
    data: {
      Object: {
        ObjectType: "Vehicle",
        BoundingBox: [-100, 0, 9000, 8191],
      },
    },
  };
  const detection = (
    classifyAmcrestEvent(ev) as { detection?: AmcrestDetection }
  ).detection;
  assert.ok(detection);
  assert.equal(detection.box.x, 0);
  assert.equal(detection.box.y, 0);
  assert.equal(detection.box.width, 1);
  assert.equal(detection.box.height, 1);
});

test("omits the detection when the payload carries no bounding box", () => {
  const c = classifyAmcrestEvent({
    code: "SmartMotionHuman",
    action: "Start",
  });
  assert.deepEqual(c, { kind: "object", category: "person", active: true });
});

test("derives a box end-to-end from a real cross-region event blob", () => {
  const blob = `Code=CrossRegionDetection;action=Start;index=0;data=${readFileSync(
    fileURLToPath(new URL("../fixtures/human-detected.json", import.meta.url)),
    "utf8",
  )}`;
  const ev = parseAmcrestEvent(blob);
  assert.ok(ev);
  const c = classifyAmcrestEvent(ev);
  const detection = (c as { detection?: AmcrestDetection }).detection;
  assert.ok(detection);
  assert.equal(detection.trackId, 863);
  // Center of the normalized box must match the payload's own Center field.
  assertClose(detection.box.x + detection.box.width / 2, 3368 / 8191);
  assertClose(detection.box.y + detection.box.height / 2, 3080 / 8191);
});

test("treats a face detection Pulse as a momentary activation", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "FaceDetection", action: "Pulse" }),
    { kind: "object", category: "person", active: true, momentary: true },
  );
});

test("treats a line-crossing Pulse as a momentary activation", () => {
  const c = classifyAmcrestEvent({
    code: "CrossLineDetection",
    action: "Pulse",
    data: { Object: { ObjectType: "Human" } },
  });
  assert.deepEqual(c, {
    kind: "object",
    category: "person",
    active: true,
    momentary: true,
  });
});

test("does not mark Start/Stop object events as momentary", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "FaceDetection", action: "Stop" }),
    { kind: "object", category: "person", active: false },
  );
});

test("activates on a real FaceDetection Pulse blob", () => {
  const blob = `Code=FaceDetection;action=Pulse;index=0;data=${readFileSync(
    fileURLToPath(new URL("../fixtures/face-detected.json", import.meta.url)),
    "utf8",
  )}`;
  const ev = parseAmcrestEvent(blob);
  assert.ok(ev);
  const c = classifyAmcrestEvent(ev) as {
    active: boolean;
    momentary?: boolean;
    detection?: AmcrestDetection;
  };
  assert.equal(c.active, true, "a Pulse must not clear the sensor");
  assert.equal(c.momentary, true);
  assert.equal(c.detection?.trackId, 94);
});

test("classifies amcrest doorbell invite", () => {
  assert.deepEqual(
    classifyAmcrestEvent({ code: "_DoTalkAction_", action: "Invite" }),
    { kind: "doorbell" },
  );
});

test("ignores unrelated events", () => {
  assert.equal(
    classifyAmcrestEvent({ code: "NTPAdjustTime", action: "Start" }),
    undefined,
  );
});
