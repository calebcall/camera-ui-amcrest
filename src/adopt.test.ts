import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCameraConfig,
  sourceNameForSubtype,
  subtypeFromSourceName,
} from './adopt.js';

test('builds a config with main+sub sources and snapshot on main', () => {
  const config = buildCameraConfig({
    name: 'Front Door',
    nativeId: 'amcrest-192.168.1.50',
    ip: '192.168.1.50',
    username: 'admin',
    password: 'pw',
    port: 554,
    channel: 1,
    info: {
      manufacturer: 'Amcrest',
      model: 'AD410',
      serialNumber: 'ABC',
      firmwareVersion: '1.0',
    },
    streams: [
      {
        role: 'high-resolution',
        subtype: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
      },
      {
        role: 'low-resolution',
        subtype: 1,
        codec: 'h265',
        width: 704,
        height: 480,
      },
    ],
  });

  assert.equal(config.name, 'Front Door');
  assert.equal(config.sources.length, 2);
  assert.equal(config.sources[0].role, 'high-resolution');
  // Snapshots come from SnapshotInterface (snapshot.cgi), not ffmpeg-over-RTSP.
  assert.equal(config.sources[0].useForSnapshot, false);
  assert.ok(
    config.sources[0].urls?.[0]?.startsWith(
      'rtsp://admin:pw@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0',
    ),
  );
  assert.equal(config.sources[1].role, 'low-resolution');
  assert.equal(config.sources[1].useForSnapshot, false);
});

test('falls back to a single main source when only one stream is present', () => {
  const config = buildCameraConfig({
    name: 'Cam',
    nativeId: 'x',
    ip: '10.0.0.1',
    username: 'a',
    password: 'b',
    port: 554,
    channel: 1,
    info: {},
    streams: [
      {
        role: 'high-resolution',
        subtype: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
      },
    ],
  });
  assert.equal(config.sources.length, 1);
  assert.equal(config.sources[0].useForSnapshot, false);
});

test('builds a source per stream when the camera serves three', () => {
  const config = buildCameraConfig({
    name: 'Cam',
    nativeId: 'x',
    ip: '10.0.0.1',
    username: 'a',
    password: 'b',
    port: 554,
    channel: 1,
    info: {},
    streams: [
      { role: 'high-resolution', subtype: 0, width: 2560, height: 1440 },
      { role: 'mid-resolution', subtype: 2, width: 1280, height: 720 },
      { role: 'low-resolution', subtype: 1, width: 640, height: 480 },
    ],
  });

  assert.equal(config.sources.length, 3);
  assert.deepEqual(
    config.sources.map((s) => s.role),
    ['high-resolution', 'mid-resolution', 'low-resolution'],
  );
  // Each source must point at its own RTSP subtype.
  assert.deepEqual(
    config.sources.map((s) => s.urls?.[0]?.match(/subtype=(\d)/)?.[1]),
    ['0', '2', '1'],
  );
  // Only the high-resolution source is kept hot; the rest connect on demand.
  assert.deepEqual(
    config.sources.map((s) => s.hotMode),
    [true, false, false],
  );
  // Declared per source, because that is the only place camera.ui reads it —
  // a timeout appended to a URL is stripped when the field is unset.
  assert.deepEqual(
    config.sources.map((s) => s.timeout),
    [30, 30, 30],
  );
  assert.deepEqual(
    config.sources.map((s) => s.name),
    ['main', 'extra2', 'extra1'],
  );
});

test('source names round-trip to the subtype they were minted from', () => {
  for (const subtype of [0, 1, 2, 3]) {
    assert.equal(
      subtypeFromSourceName(sourceNameForSubtype(subtype)),
      subtype,
      `subtype ${subtype} did not survive the round trip`,
    );
  }
});

test('a name the plugin never minted resolves to no subtype', () => {
  // A user is free to rename a source in camera.ui; the caller falls back to the
  // relay rather than guessing a subtype.
  assert.equal(subtypeFromSourceName('Driveway'), undefined);
  assert.equal(subtypeFromSourceName('extra'), undefined);
  assert.equal(subtypeFromSourceName('extra1x'), undefined);
  assert.equal(subtypeFromSourceName(''), undefined);
});
