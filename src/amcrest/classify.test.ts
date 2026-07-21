import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyAmcrestEvent } from './classify.js';

test('classifies motion start/stop', () => {
  assert.deepEqual(classifyAmcrestEvent({ code: 'VideoMotion', action: 'Start' }), { kind: 'motion', active: true });
  assert.deepEqual(classifyAmcrestEvent({ code: 'VideoMotion', action: 'Stop' }), { kind: 'motion', active: false });
});

test('classifies audio mutation', () => {
  assert.deepEqual(classifyAmcrestEvent({ code: 'AudioMutation', action: 'Start' }), { kind: 'audio', active: true });
});

test('classifies smart human and vehicle', () => {
  assert.deepEqual(classifyAmcrestEvent({ code: 'SmartMotionHuman', action: 'Start' }), { kind: 'object', category: 'person', active: true });
  assert.deepEqual(classifyAmcrestEvent({ code: 'Vehicle', action: 'Start' }), { kind: 'object', category: 'vehicle', active: true });
});

test('classifies cross-region by ObjectType', () => {
  const ev = { code: 'CrossRegionDetection', action: 'Start', data: { Object: { ObjectType: 'Human' } } };
  assert.deepEqual(classifyAmcrestEvent(ev), { kind: 'object', category: 'person', active: true });
});

test('classifies amcrest doorbell invite', () => {
  assert.deepEqual(classifyAmcrestEvent({ code: '_DoTalkAction_', action: 'Invite' }), { kind: 'doorbell' });
});

test('ignores unrelated events', () => {
  assert.equal(classifyAmcrestEvent({ code: 'NTPAdjustTime', action: 'Start' }), undefined);
});
