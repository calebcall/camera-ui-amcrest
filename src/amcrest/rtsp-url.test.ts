import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRtspUrl } from "./rtsp-url.js";

test("builds main stream url with defaults", () => {
  const url = buildRtspUrl({
    ip: "192.168.1.50",
    username: "admin",
    password: "pw",
    subtype: 0,
  });
  assert.equal(
    url,
    "rtsp://admin:pw@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0",
  );
});

test("builds sub stream url with custom port and channel", () => {
  const url = buildRtspUrl({
    ip: "10.0.0.9",
    username: "admin",
    password: "pw",
    port: 5544,
    channel: 2,
    subtype: 1,
  });
  assert.equal(
    url,
    "rtsp://admin:pw@10.0.0.9:5544/cam/realmonitor?channel=2&subtype=1",
  );
});

test("url-encodes credentials with special characters", () => {
  const url = buildRtspUrl({
    ip: "192.168.1.50",
    username: "ad@min",
    password: "p:w/d",
    subtype: 0,
  });
  assert.equal(
    url,
    "rtsp://ad%40min:p%3Aw%2Fd@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0",
  );
});
