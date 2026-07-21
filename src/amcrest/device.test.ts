import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyDevice } from './device.js';

test('AD410 is an amcrest doorbell', () => {
  assert.deepEqual(classifyDevice('AD410'), { isDoorbell: true, family: 'amcrest' });
});

test('VTO intercom is a dahua doorbell', () => {
  assert.deepEqual(classifyDevice('VTO2211G-P'), { isDoorbell: true, family: 'dahua' });
});

test('DH-VTO intercom is a dahua doorbell', () => {
  assert.deepEqual(classifyDevice('DH-VTO2211G-P'), { isDoorbell: true, family: 'dahua' });
});

test('DH- prefixed non-VTO device is dahua and not a doorbell', () => {
  assert.deepEqual(classifyDevice('DH-IPC-HDW2431T'), { isDoorbell: false, family: 'dahua' });
});

test('plain IPC device is amcrest and not a doorbell', () => {
  assert.deepEqual(classifyDevice('IPC-HDW4631C'), { isDoorbell: false, family: 'amcrest' });
});

test('DB-prefixed device is a dahua doorbell', () => {
  assert.deepEqual(classifyDevice('DB61'), { isDoorbell: true, family: 'dahua' });
});

test('undefined device type defaults to amcrest, not a doorbell', () => {
  assert.deepEqual(classifyDevice(undefined), { isDoorbell: false, family: 'amcrest' });
});
