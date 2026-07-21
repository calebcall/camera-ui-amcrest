import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseKeyValueBody, parseSystemInfo } from './system-info.js';

const SAMPLE = `appAutoStart=true
deviceType=IP4M-1041B
hardwareVersion=1.00
processor=SSC327DE
serialNumber=ABC12345`;

test('parseKeyValueBody splits key=value lines', () => {
  const kv = parseKeyValueBody(SAMPLE);
  assert.equal(kv.deviceType, 'IP4M-1041B');
  assert.equal(kv.serialNumber, 'ABC12345');
  assert.equal(kv.processor, 'SSC327DE');
});

test('parseSystemInfo extracts identity fields', () => {
  const info = parseSystemInfo(SAMPLE);
  assert.deepEqual(info, { deviceType: 'IP4M-1041B', hardwareVersion: '1.00', serialNumber: 'ABC12345' });
});

test('parseSystemInfo throws when not an amcrest device', () => {
  assert.throws(() => parseSystemInfo('foo=bar\nbaz=qux'), /not amcrest/);
});
