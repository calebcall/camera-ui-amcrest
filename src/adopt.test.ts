import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCameraConfig } from "./adopt.js";

test("builds a config with main+sub sources and snapshot on main", () => {
  const config = buildCameraConfig({
    name: "Front Door",
    nativeId: "amcrest-192.168.1.50",
    ip: "192.168.1.50",
    username: "admin",
    password: "pw",
    port: 554,
    channel: 1,
    info: {
      manufacturer: "Amcrest",
      model: "AD410",
      serialNumber: "ABC",
      firmwareVersion: "1.0",
    },
    streams: [
      { role: "main", subtype: 0, codec: "h264", width: 1920, height: 1080 },
      { role: "sub", subtype: 1, codec: "h265", width: 704, height: 480 },
    ],
  });

  assert.equal(config.name, "Front Door");
  assert.equal(config.sources.length, 2);
  assert.equal(config.sources[0].role, "high-resolution");
  // Snapshots come from SnapshotInterface (snapshot.cgi), not ffmpeg-over-RTSP.
  assert.equal(config.sources[0].useForSnapshot, false);
  assert.ok(
    config.sources[0].urls?.[0]?.startsWith(
      "rtsp://admin:pw@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0",
    ),
  );
  assert.equal(config.sources[1].role, "low-resolution");
  assert.equal(config.sources[1].useForSnapshot, false);
});

test("falls back to a single main source when only one stream is present", () => {
  const config = buildCameraConfig({
    name: "Cam",
    nativeId: "x",
    ip: "10.0.0.1",
    username: "a",
    password: "b",
    port: 554,
    channel: 1,
    info: {},
    streams: [
      { role: "main", subtype: 0, codec: "h264", width: 1920, height: 1080 },
    ],
  });
  assert.equal(config.sources.length, 1);
  assert.equal(config.sources[0].useForSnapshot, false);
});
