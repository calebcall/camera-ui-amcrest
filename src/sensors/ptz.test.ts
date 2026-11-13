import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AmcrestPTZSensor } from './ptz.js';

import type { AmcrestClient } from '../amcrest/api.js';
import type { PtzCommand } from '../amcrest/ptz-commands.js';

function fakeClient(): { client: AmcrestClient; sent: PtzCommand[] } {
  const sent: PtzCommand[] = [];
  const client = {
    sendPtzCommand: async (_channel: number, cmd: PtzCommand) => {
      sent.push(cmd);
    },
  } as unknown as AmcrestClient;
  return { client, sent };
}

const STOP = { panSpeed: 0, tiltSpeed: 0, zoomSpeed: 0 };

test('releasing zoom in stops ZoomTele', async () => {
  const { client, sent } = fakeClient();
  const ptz = new AmcrestPTZSensor(client, 1);
  await ptz.setVelocity({ panSpeed: 0, tiltSpeed: 0, zoomSpeed: 1 });
  await ptz.setVelocity(STOP);
  assert.deepEqual(
    sent.map((c) => `${c.action}:${c.code}`),
    ['start:ZoomTele', 'stop:ZoomTele'],
  );
});

test('changing direction stops the previous move first', async () => {
  const { client, sent } = fakeClient();
  const ptz = new AmcrestPTZSensor(client, 1);
  await ptz.setVelocity({ panSpeed: 0, tiltSpeed: 0, zoomSpeed: -1 });
  await ptz.setVelocity({ panSpeed: 1, tiltSpeed: 0, zoomSpeed: 0 });
  await ptz.setVelocity(STOP);
  assert.deepEqual(
    sent.map((c) => `${c.action}:${c.code}`),
    ['start:ZoomWide', 'stop:ZoomWide', 'start:Right', 'stop:Right'],
  );
});

test('a second stop after the move ended falls back to Up', async () => {
  const { client, sent } = fakeClient();
  const ptz = new AmcrestPTZSensor(client, 1);
  await ptz.setVelocity({ panSpeed: 0, tiltSpeed: -1, zoomSpeed: 0 });
  await ptz.setVelocity(STOP);
  await ptz.setVelocity(STOP);
  assert.deepEqual(
    sent.map((c) => `${c.action}:${c.code}`),
    ['start:Down', 'stop:Down', 'stop:Up'],
  );
});
