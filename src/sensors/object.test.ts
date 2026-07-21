import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AmcrestObjectSensor } from './object.js';

test('tracks active categories and reports full-frame detections', () => {
  const calls: Array<{ active: boolean; labels: string[] }> = [];
  const sensor = new AmcrestObjectSensor();
  // Override the SDK method to observe calls.
  (sensor as unknown as { reportDetections: (active: boolean, dets?: Array<{ label: string }>) => void }).reportDetections = (active, dets) => {
    calls.push({ active, labels: (dets ?? []).map((d) => d.label) });
  };

  sensor.report('person', true);
  sensor.report('vehicle', true);
  sensor.report('person', false);
  sensor.report('vehicle', false);

  assert.deepEqual(calls[0], { active: true, labels: ['person'] });
  assert.deepEqual(calls[1], { active: true, labels: ['person', 'vehicle'] });
  assert.deepEqual(calls[2], { active: true, labels: ['vehicle'] });
  assert.deepEqual(calls[3], { active: false, labels: [] });
});
