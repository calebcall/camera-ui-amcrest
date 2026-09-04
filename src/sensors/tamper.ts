import { TamperSensor } from '@camera.ui/sdk';

import { CodeLatch } from './code-latch.js';

/**
 * Reports the camera's own view-interference events — lens covered, scene
 * changed, defocused — as one tamper state.
 *
 * Several codes share the sensor, so the latch owns which are active rather
 * than the boolean: a `SceneChange` Stop must not clear a tamper a `VideoBlind`
 * Start is still holding.
 */
export class AmcrestTamperSensor extends TamperSensor {
  private readonly latch: CodeLatch;

  constructor(pulseTimeoutMs?: number) {
    super('Amcrest Tamper');
    this.latch = new CodeLatch(
      (detected) => this.setDetected(detected),
      pulseTimeoutMs,
    );
  }

  report(code: string, active: boolean): void {
    this.latch.report(code, active);
  }

  pulse(code: string): void {
    this.latch.pulse(code);
  }

  /** The codes currently holding tamper up, for logging. */
  get activeCodes(): string[] {
    return this.latch.codes;
  }

  destroy(): void {
    this.latch.destroy();
  }
}
