import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeSnapshotRejection } from './snapshot.js';

/** The shortest thing that passes for a JPEG: SOI plus one byte. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

test('a JPEG body is not a rejection', () => {
  assert.equal(describeSnapshotRejection(200, 'OK', JPEG), undefined);
});

test('a non-2xx status is a rejection naming the status', () => {
  const message = describeSnapshotRejection(
    503,
    'Service Unavailable',
    Buffer.alloc(0),
  );
  assert.ok(message);
  assert.match(message, /HTTP 503 Service Unavailable/);
  assert.match(message, /out of spare connections/);
});

test('a rejection quotes the plain-text body the camera explained itself with', () => {
  const message = describeSnapshotRejection(
    400,
    'Bad Request',
    Buffer.from('Error\r\n\r\nchannel invalid'),
  );
  assert.ok(message);
  // Collapsed onto one line so a multi-line answer stays one log entry.
  assert.match(message, /Error channel invalid/);
  assert.match(message, /snapshots are enabled on the camera/);
});

test('a status with no hint still names itself', () => {
  const message = describeSnapshotRejection(500, '', Buffer.alloc(0));
  assert.equal(message, 'Camera refused the snapshot request: HTTP 500');
});

test('a 200 with an empty body is a rejection', () => {
  const message = describeSnapshotRejection(200, 'OK', Buffer.alloc(0));
  assert.equal(
    message,
    'Camera answered the snapshot request with an empty body',
  );
});

test('a 200 carrying an HTML error page is a rejection, not a picture', () => {
  // The path that made this bug silent: fetch resolves, the body is non-empty,
  // and camera.ui caches whatever a plugin hands it.
  const body = Buffer.from('<html><body>Not Found</body></html>');
  const message = describeSnapshotRejection(200, 'OK', body);
  assert.ok(message);
  assert.match(message, /are not a JPEG/);
  assert.match(message, /<html><body>Not Found<\/body><\/html>/);
});

test('a 200 carrying binary that is not a JPEG is rejected without quoting it', () => {
  // A PNG, say. Quoting arbitrary bytes would wreck the log line, so the byte
  // count is all that gets said.
  const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const message = describeSnapshotRejection(200, 'OK', body);
  assert.equal(
    message,
    'Camera answered the snapshot request with 8 bytes that are not a JPEG',
  );
});

test('a body too short to carry a marker is rejected', () => {
  assert.ok(describeSnapshotRejection(200, 'OK', Buffer.from([0xff, 0xd8])));
});

test('a body whose first bytes only resemble the marker is rejected', () => {
  const body = Buffer.from([0xff, 0xd8, 0xfe, 0x00, 0x10]);
  assert.ok(describeSnapshotRejection(200, 'OK', body));
});

test('a 2xx that is not 200 is accepted when the body is a JPEG', () => {
  assert.equal(
    describeSnapshotRejection(206, 'Partial Content', JPEG),
    undefined,
  );
});
