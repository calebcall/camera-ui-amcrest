import { ProblemSensor } from '@camera.ui/sdk';

import { CodeLatch } from './code-latch.js';

/**
 * Reports the camera's own fault events — lost video signal, missing or failing
 * storage — as one problem state. Shares the multi-code latch with the tamper
 * sensor for the same reason: a full SD card and a video loss are independent,
 * and either one alone must keep the sensor up.
 */
export class AmcrestProblemSensor extends ProblemSensor {
  private readonly latch: CodeLatch;

  constructor(pulseTimeoutMs?: number) {
    super('Amcrest Problem');
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

  /** The codes currently holding the problem state up, for logging. */
  get activeCodes(): string[] {
    return this.latch.codes;
  }

  destroy(): void {
    this.latch.destroy();
  }
}
