import assert from "node:assert/strict";
import { test } from "node:test";

import { AmcrestCamera } from "./camera.js";
import { compileZones } from "./zones/filter.js";

import type { AmcrestDetection } from "./amcrest/classify.js";
import type { CompiledZone } from "./zones/filter.js";
import type {
  CameraDevice,
  DetectionLabel,
  DetectionZone,
} from "@camera.ui/sdk";

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
  applyDetectionZones(zones: DetectionZone[]): void;
  suppressedStarts: Map<DetectionLabel, string>;
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
  forget: () => void;
  setZones: (zones: DetectionZone[]) => void;
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

  return {
    dispatch: (blob) => internals.dispatchEvent(blob),
    forget: () => internals.suppressedStarts.clear(),
    // The real code path the detectionZones subscriber runs, so a test can edit
    // the zone list exactly as a user would mid-event.
    setZones: (next) => internals.applyDetectionZones(next),
    calls,
    debug,
  };
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

/** Two objects in one event: one inside the zone, one outside it. */
const MIXED_HUMANS =
  'Code=SmartMotionHuman;action=Start;index=0;data={"object":' +
  '[{"Rect":[3000,3000,4000,4000],"HumanID":1},' +
  '{"Rect":[7000,7000,7500,7500],"HumanID":2}]}';

test("dispatchEvent: an object that enters the zones after a suppressed Start is logged, not alerted", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  const hit = h.debug.find((l) =>
    l.includes("entered the zones during the event"),
  );
  assert.ok(hit, `expected the walk-in line, got: ${JSON.stringify(h.debug)}`);
  assert.ok(hit.includes("Stop box [0.37,0.37,0.12,0.12]"), hit);
  assert.ok(
    hit.includes(
      "box [0.85,0.85,0.06,0.06] outside include zone(s) 'Driveway'",
    ),
    hit,
  );

  // Observation only. No activation was synthesised, and the deactivation still
  // reported — exactly what 1.4.0 did.
  assert.deepEqual(
    h.calls.map((c) => ({ method: c.method, active: c.active })),
    [{ method: "report", active: false }],
  );
});

test("dispatchEvent: an object that stays outside the zones logs the miss, not the walk-in", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.ok(
    h.debug.some((l) =>
      l.includes("stayed outside the zones for the whole event"),
    ),
    `expected the miss line, got: ${JSON.stringify(h.debug)}`,
  );
  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
});

test("dispatchEvent: a coordinate-free Stop after a suppressed Start says only that it cannot tell", () => {
  // Neither of the other two lines is true here: with no position on the Stop,
  // whether the object entered the zone is unknowable, and saying it stayed
  // outside would be false. Saying so keeps the log decidable — silence would be
  // indistinguishable from "walk-ins never happen".
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch("Code=SmartMotionHuman;action=Stop;index=0");

  assert.ok(
    h.debug.some((l) =>
      l.includes(
        "left without coordinates — cannot tell whether it entered the zones",
      ),
    ),
    `expected the cannot-tell line, got: ${JSON.stringify(h.debug)}`,
  );
  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
  assert.ok(!h.debug.some((l) => l.includes("stayed outside the zones")));
});

test("dispatchEvent: a suppressed Pulse is not remembered, so a later Stop says nothing about it", () => {
  // A Pulse never receives a matching Stop. Remembering one would leave an entry
  // that an unrelated later Stop would wrongly be measured against.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Pulse", OUTSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
  assert.ok(!h.debug.some((l) => l.includes("stayed outside the zones")));
});

test("dispatchEvent: a cleanly passing activation says so", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", INSIDE_RECT));

  assert.ok(
    h.debug.some(
      (l) =>
        l.includes("passed detection zones (1 zone(s))") &&
        l.includes("box [0.37,0.37,0.12,0.12]"),
    ),
    `expected the pass-through line, got: ${JSON.stringify(h.debug)}`,
  );
});

test("dispatchEvent: a partially filtered event reports the partial line, not the pass line", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(MIXED_HUMANS);

  assert.ok(
    h.debug.some((l) => l.includes("partially filtered by detection zones")),
    `expected the partial line, got: ${JSON.stringify(h.debug)}`,
  );
  assert.ok(
    !h.debug.some((l) => l.includes("passed detection zones")),
    "the partial line already names what was dropped; the pass line would duplicate it",
  );
  assert.equal(h.calls[0].detections.length, 1);
  assert.equal(h.calls[0].detections[0].trackId, 1);
});

test("dispatchEvent: a suppression forgotten on reconnect is not measured against a later Stop", () => {
  // What runEventLoop does when the stream drops: track continuity is gone, so a
  // pending suppression must not be paired with an unrelated Stop minutes later.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.forget();
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
});

/** Every zone verdict flips if this replaces DRIVEWAY: it accepts the frame. */
const WHOLE_FRAME: DetectionZone = {
  ...DRIVEWAY,
  name: "Everywhere",
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
};

/** The three lines reviewSuppressedStart can emit about a pending suppression. */
function walkInLines(debug: string[]): string[] {
  return debug.filter(
    (l) =>
      l.includes("entered the zones during the event") ||
      l.includes("stayed outside the zones") ||
      l.includes("cannot tell whether it entered the zones"),
  );
}

test("dispatchEvent: a zone edit between Start and Stop forgets the suppression instead of contradicting it", () => {
  // The recorded reason describes the zones as they were at the Start. Judging
  // the Stop against the enlarged list would claim the identical box both failed
  // and passed, for an object that never moved.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.setZones([WHOLE_FRAME]);
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.deepEqual(
    walkInLines(h.debug),
    [],
    `the same box cannot both fail and pass: ${JSON.stringify(h.debug)}`,
  );
  assert.deepEqual(
    h.calls.map((c) => ({ method: c.method, active: c.active })),
    [{ method: "report", active: false }],
    "still observation only",
  );
});

test("dispatchEvent: deleting every zone between Start and Stop says nothing about the suppression", () => {
  // The no-zones-drawn case specifically: a walk-in line here would be emitted
  // with an empty zone list, which is exactly what must stay silent.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.setZones([]);
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.deepEqual(
    walkInLines(h.debug),
    [],
    `no zones drawn means nothing to say: ${JSON.stringify(h.debug)}`,
  );
});

test("dispatchEvent: a suppression is forgotten once a later activation of the same category alerts", () => {
  // Sidewalk person suppressed, driveway person alerts, driveway person leaves.
  // An alert *was* sent, so the walk-in line would be false — and its "would
  // pass" box belongs to the object that already alerted.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Start", INSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.deepEqual(
    walkInLines(h.debug),
    [],
    `an alert was sent, so nothing may claim otherwise: ${JSON.stringify(h.debug)}`,
  );
  assert.deepEqual(
    h.calls.map((c) => ({ method: c.method, active: c.active })),
    [
      { method: "report", active: true },
      { method: "report", active: false },
    ],
    "sensor calls stay identical to 1.4.0",
  );
});

test("dispatchEvent: a boxless activation also forgets an earlier suppression", () => {
  // The boxless path reports unfiltered, so it alerts too. Same false claim.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch("Code=SmartMotionHuman;action=Start;index=0");
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.deepEqual(walkInLines(h.debug), [], JSON.stringify(h.debug));
});

test("dispatchEvent: two suppressed Starts for one category still produce a single line", () => {
  // The map is category-keyed while the events are per-track, so overlapping
  // same-category tracks pair best-effort. Pinned so it cannot change silently.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.equal(
    walkInLines(h.debug).length,
    1,
    `one Stop resolves at most one pending suppression: ${JSON.stringify(h.debug)}`,
  );
});
