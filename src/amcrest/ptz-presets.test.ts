import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gotoPresetCommand, parsePtzPresets } from './ptz-presets.js';

test('parses presets in index order', () => {
  const reply = [
    'presets[0].Index=2',
    'presets[0].Name=Driveway',
    'presets[0].Type=0',
    'presets[1].Index=1',
    'presets[1].Name=Front Door',
    'presets[1].Type=0',
    '',
  ].join('\r\n');
  assert.deepEqual(parsePtzPresets(reply), [
    { index: 1, name: 'Front Door' },
    { index: 2, name: 'Driveway' },
  ]);
});

test('unnamed presets get a numbered name', () => {
  assert.deepEqual(parsePtzPresets('presets[0].Index=3\npresets[0].Name=\n'), [
    { index: 3, name: 'Preset 3' },
  ]);
});

test('duplicate names are made unique with the index', () => {
  const reply = [
    'presets[0].Index=1',
    'presets[0].Name=Gate',
    'presets[1].Index=4',
    'presets[1].Name=Gate',
  ].join('\n');
  assert.deepEqual(parsePtzPresets(reply), [
    { index: 1, name: 'Gate' },
    { index: 4, name: 'Gate (4)' },
  ]);
});

test('empty, error and malformed replies give no presets', () => {
  assert.deepEqual(parsePtzPresets(''), []);
  assert.deepEqual(parsePtzPresets('Error\r\nBad Request!\r\n'), []);
  assert.deepEqual(parsePtzPresets('presets[0].Name=NoIndex\n'), []);
});

test('goto preset command', () => {
  assert.deepEqual(gotoPresetCommand(7), {
    action: 'start',
    code: 'GotoPreset',
    arg2: 7,
  });
});
