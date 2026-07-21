export interface PtzVelocity {
  panSpeed?: number;
  tiltSpeed?: number;
  zoomSpeed?: number;
}

export interface PtzCommand {
  action: 'start' | 'stop';
  code: string;
  arg2: number;
}

function toSpeed(magnitude: number): number {
  const clamped = Math.min(1, Math.abs(magnitude));
  return Math.max(1, Math.round(clamped * 8));
}

export function ptzCommandForVelocity(v: PtzVelocity): PtzCommand {
  const pan = v.panSpeed ?? 0;
  const tilt = v.tiltSpeed ?? 0;
  const zoom = v.zoomSpeed ?? 0;

  if (pan === 0 && tilt === 0 && zoom === 0) {
    return { action: 'stop', code: 'Up', arg2: 0 };
  }

  if (zoom !== 0) {
    return {
      action: 'start',
      code: zoom > 0 ? 'ZoomTele' : 'ZoomWide',
      arg2: toSpeed(zoom),
    };
  }
  if (tilt !== 0) {
    return {
      action: 'start',
      code: tilt > 0 ? 'Up' : 'Down',
      arg2: toSpeed(tilt),
    };
  }
  return {
    action: 'start',
    code: pan > 0 ? 'Right' : 'Left',
    arg2: toSpeed(pan),
  };
}
