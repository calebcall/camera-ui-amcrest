import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CodeLatch } from './code-latch.js';

function observe(pulseTimeoutMs?: number): {
  latch: CodeLatch;
  states: boolean[];
} {
  const states: boolean[] = [];
  const latch = new CodeLatch(
    (detected) => states.push(detected),
    pulseTimeoutMs,
  );
  return { latch, states };
}

test('one code raises and clears the state', () => {
  const { latch, states } = observe();

  latch.report('VideoBlind', true);
  latch.report('VideoBlind', false);

  assert.deepEqual(states, [true, false]);
});

test('a second code keeps the state up after the first ends', () => {
  // The reason this class exists: one sensor stands for several codes, and a
  // Stop for one must not clear a state another is still holding.
  const { latch, states } = observe();

  latch.report('VideoBlind', true);
  latch.report('SceneChange', true);
  latch.report('VideoBlind', false);

  assert.deepEqual(states, [true, true, true]);
  assert.deepEqual(latch.codes, ['SceneChange']);

  latch.report('SceneChange', false);
  assert.equal(states[states.length - 1], false);
});

test('a Stop for a code that never started is harmless', () => {
  // A camera can send a Stop the plugin never saw the Start for — after an
  // event-stream reconnect, say.
  const { latch, states } = observe();

  latch.report('VideoBlind', true);
  latch.report('VideoLoss', false);

  assert.equal(states[states.length - 1], true);
  assert.deepEqual(latch.codes, ['VideoBlind']);
});

test('a repeated Start does not double-count the code', () => {
  const { latch } = observe();

  latch.report('VideoBlind', true);
  latch.report('VideoBlind', true);
  latch.report('VideoBlind', false);

  assert.deepEqual(latch.codes, []);
});

test('a pulse clears itself after the timeout', (t) => {
  // Firmware that sends these as Pulse would otherwise latch the sensor on
  // until the plugin restarts, which reads as permanent tamper.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { latch, states } = observe(30_000);

  latch.pulse('SceneChange');
  assert.deepEqual(states, [true]);

  t.mock.timers.tick(29_999);
  assert.equal(states.length, 1, 'must not clear before the timeout elapses');

  t.mock.timers.tick(1);
  assert.equal(states[states.length - 1], false);
});

test('a repeated pulse extends the window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { latch, states } = observe(30_000);

  latch.pulse('SceneChange');
  t.mock.timers.tick(20_000);
  latch.pulse('SceneChange');
  t.mock.timers.tick(20_000);

  assert.ok(states.every((s) => s));
  t.mock.timers.tick(10_000);
  assert.equal(states[states.length - 1], false);
});

test('a pulse expiry does not clear a code held by Start', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { latch, states } = observe(30_000);

  latch.pulse('SceneChange');
  latch.report('VideoBlind', true);
  t.mock.timers.tick(30_000);

  assert.equal(states[states.length - 1], true);
  assert.deepEqual(latch.codes, ['VideoBlind']);
});

test('a Start after a pulse takes ownership of the code', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { latch, states } = observe(30_000);

  latch.pulse('VideoBlind');
  latch.report('VideoBlind', true);
  t.mock.timers.tick(60_000);

  assert.equal(
    states[states.length - 1],
    true,
    'Start/Stop owns it after a Start',
  );
});

test('destroy cancels pending pulse timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { latch, states } = observe(30_000);

  latch.pulse('SceneChange');
  latch.destroy();
  t.mock.timers.tick(60_000);

  assert.deepEqual(states, [true], 'no change should fire after destroy');
});
