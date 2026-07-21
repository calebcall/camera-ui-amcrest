import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { parseAmcrestEvent } from './events.js';

const humanData = readFileSync(fileURLToPath(new URL('../fixtures/human-detected.json', import.meta.url)), 'utf8');
const faceData = readFileSync(fileURLToPath(new URL('../fixtures/face-detected.json', import.meta.url)), 'utf8');

test('parses a motion start event without data', () => {
  const ev = parseAmcrestEvent('Code=VideoMotion;action=Start;index=0');
  assert.deepEqual(ev, { code: 'VideoMotion', action: 'Start', index: 0, data: undefined });
});

test('parses a smart event with JSON data payload', () => {
  const blob = `Code=CrossRegionDetection;action=Start;index=0;data=${humanData}`;
  const ev = parseAmcrestEvent(blob);
  assert.equal(ev?.code, 'CrossRegionDetection');
  assert.equal(ev?.action, 'Start');
  assert.equal((ev?.data as { Object: { ObjectType: string } }).Object.ObjectType, 'Human');
});

test('parses a face detection event with JSON data payload', () => {
  const blob = `Code=FaceDetection;action=Start;index=0;data=${faceData}`;
  const ev = parseAmcrestEvent(blob);
  assert.equal(ev?.code, 'FaceDetection');
  assert.equal(ev?.action, 'Start');
  assert.equal((ev?.data as { Object: { ObjectType: string } }).Object.ObjectType, 'HumanFace');
});

test('tolerates malformed JSON data', () => {
  const ev = parseAmcrestEvent('Code=X;action=Start;data={not json');
  assert.equal(ev?.code, 'X');
  assert.equal(ev?.data, undefined);
});

test('returns undefined when no Code present', () => {
  assert.equal(parseAmcrestEvent('Heartbeat'), undefined);
});
