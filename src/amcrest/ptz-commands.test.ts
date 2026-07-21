import assert from "node:assert/strict";
import { test } from "node:test";

import { ptzCommandForVelocity } from "./ptz-commands.js";

test("zero velocity is a stop", () => {
  assert.deepEqual(
    ptzCommandForVelocity({ panSpeed: 0, tiltSpeed: 0, zoomSpeed: 0 }),
    { action: "stop", code: "Up", arg2: 0 },
  );
});

test("pan right", () => {
  const c = ptzCommandForVelocity({ panSpeed: 1 });
  assert.equal(c.action, "start");
  assert.equal(c.code, "Right");
  assert.equal(c.arg2, 8);
});

test("pan left at half speed", () => {
  const c = ptzCommandForVelocity({ panSpeed: -0.5 });
  assert.equal(c.code, "Left");
  assert.equal(c.arg2, 4);
});

test("tilt up takes priority over pan", () => {
  const c = ptzCommandForVelocity({ panSpeed: 0.2, tiltSpeed: 0.9 });
  assert.equal(c.code, "Up");
});

test("zoom tele takes highest priority", () => {
  const c = ptzCommandForVelocity({
    panSpeed: 0.9,
    tiltSpeed: 0.9,
    zoomSpeed: 0.3,
  });
  assert.equal(c.code, "ZoomTele");
});
