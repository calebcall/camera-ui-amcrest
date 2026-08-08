import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeTalkbackRejection,
  selectTalkbackTarget,
} from './talkback.js';

test('amcrest doorbell defaults to AAC', () => {
  assert.deepEqual(selectTalkbackTarget('AD410'), {
    codec: 'aac',
    contentType: 'Audio/AAC',
    sampleRate: 16000,
  });
});

test('unknown device defaults to AAC', () => {
  assert.deepEqual(selectTalkbackTarget(undefined), {
    codec: 'aac',
    contentType: 'Audio/AAC',
    sampleRate: 16000,
  });
});

test('dahua device uses G.711A', () => {
  assert.deepEqual(selectTalkbackTarget('DH-VTO2211'), {
    codec: 'pcm_alaw',
    contentType: 'Audio/G.711A',
    sampleRate: 8000,
  });
});

test('plain VTO intercom (no DH- prefix) uses G.711A', () => {
  assert.deepEqual(selectTalkbackTarget('VTO2211'), {
    codec: 'pcm_alaw',
    contentType: 'Audio/G.711A',
    sampleRate: 8000,
  });
});

test('a 2xx talkback response is not a rejection', () => {
  assert.equal(describeTalkbackRejection(200, 'OK', ''), undefined);
  assert.equal(describeTalkbackRejection(204, 'No Content', ''), undefined);
});

test('a rejection names the status code', () => {
  const msg = describeTalkbackRejection(503, 'Service Unavailable', '');
  assert.ok(msg?.includes('HTTP 503'), msg);
  assert.ok(msg?.includes('Service Unavailable'), msg);
});

test('a rejection quotes the body the camera sent back', () => {
  const msg = describeTalkbackRejection(400, 'Bad Request', 'Error\r\nbad param');
  assert.ok(msg?.includes('Error bad param'), msg);
});

test('an oversized rejection body is truncated', () => {
  const msg = describeTalkbackRejection(400, 'Bad Request', 'x'.repeat(500));
  assert.ok(msg.length < 400, `expected a trimmed message, got ${msg.length} chars`);
});

test('401 points at the credentials, 400 at the codec, 404 at the missing endpoint', () => {
  assert.ok(describeTalkbackRejection(401, '', '')?.includes('credentials'));
  assert.ok(describeTalkbackRejection(400, '', '')?.includes('codec'));
  assert.ok(describeTalkbackRejection(404, '', '')?.includes('does not expose'));
});

test('a status with no hint still reports cleanly', () => {
  const msg = describeTalkbackRejection(500, 'Internal Server Error', '');
  assert.ok(msg?.startsWith('Camera rejected talkback audio: HTTP 500'), msg);
});
