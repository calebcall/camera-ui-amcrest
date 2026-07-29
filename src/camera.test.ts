import assert from "node:assert/strict";
import { test } from "node:test";

import { AmcrestCamera } from "./camera.js";
import { compileZones } from "./zones/filter.js";

import type { AmcrestDetection } from "./amcrest/classify.js";
import type { CompiledZone } from "./zones/filter.js";
import type { CameraDevice, DetectionZone } from "@camera.ui/sdk";

/** A 0.2-0.8 include/intersect square. */
const DRIVEWAY: DetectionZone = {
  name: "Driveway",
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
};

// 0-8191 rectangles, as the camera sends them.
const OUTSIDE_RECT = "[7000,7000,7500,7500]"; // 0.85-0.92, clear of the zone
const INSIDE_RECT = "[3000,3000,4000,4000]"; // 0.37-0.49, inside the zone

function human(action: string, rect: string): string {
  return `Code=SmartMotionHuman;action=${action};index=0;data={"object":[{"Rect":${rect},"HumanID":7}]}`;
}

interface SensorCall {
  method: "report" | "pulse";
  category: string;
  active?: boolean;
  detections: AmcrestDetection[];
}

interface CameraInternals {
  zones: CompiledZone[];
  object: {
    report(
      category: string,
      active: boolean,
      detections?: AmcrestDetection[],
    ): void;
    pulse(category: string, detections?: AmcrestDetection[]): void;
  };
  dispatchEvent(blob: string): void;
}

/**
 * An AmcrestCamera wired to a fake object sensor and a fixed zone list.
 *
 * dispatchEvent is the only thing under test and it touches neither the client
 * nor the relay, so the CameraDevice fake only has to satisfy the constructor —
 * a logger and a storage factory. The private fields are set directly rather
 * than by running initialize(), which would need a real camera on the network.
 */
function harness(zones: DetectionZone[]): {
  dispatch: (blob: string) => void;
  calls: SensorCall[];
  debug: string[];
} {
  const debug: string[] = [];
  const noop = (): void => {};
  const device = {
    name: "Front Door",
    logger: {
      log: noop,
      warn: noop,
      error: noop,
      attention: noop,
      debug: (...parts: unknown[]) => debug.push(parts.join(" ")),
    },
    createStorage: () => ({ values: {}, save: async () => {} }),
  };

  const camera = new AmcrestCamera(device as unknown as CameraDevice);
  const internals = camera as unknown as CameraInternals;
  const calls: SensorCall[] = [];

  internals.zones = compileZones(zones);
  internals.object = {
    report: (category, active, detections) =>
      calls.push({
        method: "report",
        category,
        active,
        detections: detections ?? [],
      }),
    pulse: (category, detections) =>
      calls.push({ method: "pulse", category, detections: detections ?? [] }),
  };

  return { dispatch: (blob) => internals.dispatchEvent(blob), calls, debug };
}

test("dispatchEvent: a suppressed activation never reaches the sensor", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));

  assert.deepEqual(h.calls, []);
  assert.ok(
    h.debug.some(
      (line) =>
        line.includes("suppressed by detection zones") &&
        line.includes("box [0.85,0.85,0.06,0.06]"),
    ),
    `expected a suppression log naming the box, got: ${JSON.stringify(h.debug)}`,
  );
});

test("dispatchEvent: the deactivation still reaches the sensor after a suppressed activation", () => {
  // The latch guarantee. If a Stop were filtered like its Start, the sensor
  // would stay active forever the first time a zone suppressed something.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "report");
  assert.equal(h.calls[0].category, "person");
  assert.equal(h.calls[0].active, false);
});

test("dispatchEvent: a matching activation reaches the sensor with its detections", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", INSIDE_RECT));

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "report");
  assert.equal(h.calls[0].active, true);
  assert.equal(h.calls[0].detections.length, 1);
  assert.equal(h.calls[0].detections[0].trackId, 7);
});

test("dispatchEvent: a momentary event still routes to pulse", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Pulse", INSIDE_RECT));

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "pulse");
  assert.equal(h.calls[0].category, "person");
  assert.equal(h.calls[0].detections.length, 1);
});

test("dispatchEvent: a suppressed momentary event reaches no sensor either", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Pulse", OUTSIDE_RECT));

  assert.deepEqual(h.calls, []);
});

test("dispatchEvent: with no zones drawn, everything is reported unchanged", () => {
  const h = harness([]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.deepEqual(
    h.calls.map((c) => ({ method: c.method, active: c.active })),
    [
      { method: "report", active: true },
      { method: "report", active: false },
    ],
  );
  assert.deepEqual(h.debug, [], "no zones means nothing to say");
});

test("dispatchEvent: a boxless activation is warned about once, and only with zones drawn", () => {
  const boxless = "Code=SmartMotionHuman;action=Start;index=0";

  const withZones = harness([DRIVEWAY]);
  withZones.dispatch(boxless);
  withZones.dispatch(boxless);
  assert.equal(withZones.calls.length, 2, "boxless events are always reported");
  assert.equal(
    withZones.debug.filter((l) => l.includes("carried no coordinates")).length,
    1,
    "the warning is emitted once per code+category",
  );

  const withoutZones = harness([]);
  withoutZones.dispatch(boxless);
  assert.deepEqual(
    withoutZones.debug,
    [],
    "with no zones drawn the warning describes a non-problem",
  );
});
