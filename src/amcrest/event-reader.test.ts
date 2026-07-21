import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractCompleteEvents, splitEventMultipart } from './event-reader.js';

const BODY = [
  '--myboundary',
  'Content-Type: text/plain',
  'Content-Length: 40',
  '',
  'Code=VideoMotion;action=Start;index=0',
  '--myboundary',
  'Content-Type: text/plain',
  'Content-Length: 39',
  '',
  'Code=VideoMotion;action=Stop;index=0',
  '--myboundary--',
].join('\r\n');

test('splits multipart body into event blobs', () => {
  const blobs = splitEventMultipart(BODY, 'myboundary');
  assert.equal(blobs.length, 2);
  assert.ok(blobs[0].includes('Code=VideoMotion;action=Start'));
  assert.ok(blobs[1].includes('Code=VideoMotion;action=Stop'));
});

test('handles the "-- boundary" (spaced) variant', () => {
  const spaced = BODY.replace(/--myboundary/g, '-- myboundary');
  const blobs = splitEventMultipart(spaced, 'myboundary');
  assert.equal(blobs.length, 2);
});

test('extractCompleteEvents: no boundary marker yields no blobs and an unchanged buffer', () => {
  const buffer = 'no boundary has arrived yet';
  const { blobs, rest } = extractCompleteEvents(buffer, 'myboundary');
  assert.deepEqual(blobs, []);
  assert.equal(rest, buffer);
});

test('extractCompleteEvents: strips a stray HTTP/1.1 200 OK status line from the emitted blob', () => {
  const buffer = ['--myboundary', 'Content-Type: text/plain', '', 'HTTP/1.1 200 OK', 'Code=VideoMotion;action=Start;index=0', '--myboundary', ''].join('\r\n');

  const { blobs } = extractCompleteEvents(buffer, 'myboundary');
  assert.equal(blobs.length, 1);
  assert.ok(!blobs[0].includes('HTTP/1.1 200 OK'));
  assert.ok(blobs[0].includes('Code=VideoMotion;action=Start;index=0'));
});

test('extractCompleteEvents: does not double-dispatch an event across chunk boundaries (regression)', () => {
  // Chunk 1 delivers one complete event (E1) followed by the start of the next
  // boundary marker — nothing after it yet, so it is the incomplete "rest".
  const chunk1 = ['--myboundary', 'Content-Type: text/plain', '', 'Code=E1;action=Start', '--myboundary', ''].join('\r\n');

  const first = extractCompleteEvents(chunk1, 'myboundary');
  assert.equal(first.blobs.length, 1);
  assert.ok(first.blobs[0].includes('Code=E1;action=Start'));

  // Chunk 2 appends a second event (E2) and its closing boundary onto the
  // previous "rest". Only E2 should be emitted this time — E1 must not
  // reappear just because it is still sitting in the accumulated buffer.
  const chunk2 = first.rest + ['Content-Type: text/plain', '', 'Code=E2;action=Start', '--myboundary', ''].join('\r\n');

  const second = extractCompleteEvents(chunk2, 'myboundary');
  assert.equal(second.blobs.length, 1);
  assert.ok(second.blobs[0].includes('Code=E2;action=Start'));
  assert.ok(!second.blobs.some((b) => b.includes('E1')));
});
