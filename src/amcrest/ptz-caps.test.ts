import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePtzCaps } from './ptz-caps.js';

// getCurrentProtocolCaps reply from an Amcrest P4M-1051 (pan/tilt, no zoom).
const P4M_1051 = `caps.AlarmLen=0
caps.AutoFocus=false
caps.AutoPan=false
caps.AutoScan=false
caps.AutoScanMax=5
caps.AutoScanMin=1
caps.Aux=false
caps.AuxMax=255
caps.AuxMin=1
caps.CamAddrMax=255
caps.CamAddrMin=1
caps.Focus=false
caps.HighAuxMask=0
caps.IntelliPtzPreset.Support=false
caps.Internal=200
caps.Iris=false
caps.Light=false
caps.LowAuxMask=0
caps.Menu=false
caps.MonAddrMax=255
caps.MonAddrMin=0
caps.MoveAbsolutely=true
caps.Name=DH-SD1
caps.Pan=true
caps.PanSpeedMax=255
caps.PanSpeedMin=1
caps.Pattern=false
caps.PatternMax=5
caps.PatternMin=1
caps.Preset=true
caps.PresetMax=25
caps.PresetMin=1
caps.PtzMotionRange.HorizontalAngle[0]=1
caps.PtzMotionRange.HorizontalAngle[1]=354
caps.PtzMotionRange.VerticalAngle[0]=-4
caps.PtzMotionRange.VerticalAngle[1]=79
caps.RemovePreset=true
caps.RemoveTour=true
caps.Tile=true
caps.TileSpeedMax=255
caps.TileSpeedMin=1
caps.Tour=true
caps.TourMax=8
caps.TourMin=1
caps.Type=1
caps.UnSupportDirections[0]=LEFTUP
caps.UnSupportDirections[1]=RIGHTUP
caps.UnSupportDirections[2]=LEFTDOWN
caps.UnSupportDirections[3]=RIGHTDOWN
caps.Wiper=false
caps.Zoom=false
caps.lowMask=2143289295
`;

test('P4M-1051: pan and tilt, no zoom', () => {
  assert.deepEqual(parsePtzCaps(P4M_1051), {
    ptz: true,
    pan: true,
    tilt: true,
    zoom: false,
    presets: true,
  });
});

test('zoom-only camera', () => {
  assert.deepEqual(
    parsePtzCaps('caps.Pan=false\r\ncaps.Tile=false\r\ncaps.Zoom=true\r\n'),
    { ptz: true, pan: false, tilt: false, zoom: true, presets: false },
  );
});

test('accepts the Tilt spelling and is case-insensitive on values', () => {
  assert.deepEqual(parsePtzCaps('caps.Pan=TRUE\ncaps.Tilt=true\n'), {
    ptz: true,
    pan: true,
    tilt: true,
    zoom: false,
    presets: false,
  });
});

test('every axis false means no PTZ', () => {
  assert.deepEqual(
    parsePtzCaps('caps.Pan=false\ncaps.Tile=false\ncaps.Zoom=false\n'),
    { ptz: false, pan: false, tilt: false, zoom: false, presets: false },
  );
});

test('empty or error reply means no PTZ', () => {
  const none = {
    ptz: false,
    pan: false,
    tilt: false,
    zoom: false,
    presets: false,
  };
  assert.deepEqual(parsePtzCaps(''), none);
  assert.deepEqual(parsePtzCaps('Error\r\nBad Request!\r\n'), none);
});

test('falls back to direction words when no axis keys are present', () => {
  assert.deepEqual(parsePtzCaps('Directions=Left,Right,Up,Down,ZoomTele\n'), {
    ptz: true,
    pan: true,
    tilt: true,
    zoom: true,
    presets: false,
  });
});

test('presets need caps.Preset=true and a movable axis', () => {
  assert.equal(parsePtzCaps('caps.Pan=true\ncaps.Preset=true\n').presets, true);
  assert.equal(
    parsePtzCaps('caps.Pan=true\ncaps.Preset=false\n').presets,
    false,
  );
  assert.equal(
    parsePtzCaps(
      'caps.Pan=false\ncaps.Tile=false\ncaps.Zoom=false\ncaps.Preset=true\n',
    ).presets,
    false,
  );
});
