import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UnhandledCodeTracker } from './unhandled-codes.js';

test('reports an unknown code once and stays quiet afterwards', () => {
  const tracker = new UnhandledCodeTracker();
  assert.equal(tracker.shouldReport('ParkingDetection'), true);
  assert.equal(tracker.shouldReport('ParkingDetection'), false);
  assert.equal(tracker.shouldReport('ParkingDetection'), false);
});

test('reports each distinct code separately', () => {
  const tracker = new UnhandledCodeTracker();
  assert.equal(tracker.shouldReport('ParkingDetection'), true);
  assert.equal(tracker.shouldReport('LeftDetection'), true);
});

test('never reports chatty housekeeping codes', () => {
  const tracker = new UnhandledCodeTracker();
  for (const code of [
    'VideoMotionInfo',
    'NTPAdjustTime',
    'TimeChange',
    'RtspSessionDisconnect',
    'NewFile',
  ]) {
    assert.equal(tracker.shouldReport(code), false, `${code} should be muted`);
  }
});

test('tracks codes independently per instance', () => {
  const a = new UnhandledCodeTracker();
  const b = new UnhandledCodeTracker();
  assert.equal(a.shouldReport('ParkingDetection'), true);
  assert.equal(b.shouldReport('ParkingDetection'), true);
});
