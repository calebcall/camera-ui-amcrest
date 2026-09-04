/** How long a pulse-activated code stays latched before clearing itself. */
const DEFAULT_PULSE_TIMEOUT_MS = 30_000;

/**
 * Tracks which of several event codes are currently active, so one boolean
 * sensor can stand for all of them.
 *
 * A camera reports `VideoBlind` and `SceneChange` independently, and both mean
 * "tamper". Without this, the Stop for one would clear a sensor the other is
 * still holding up. The set is the state; the sensor is true while anything is
 * in it.
 *
 * Pulse-activated codes expire on a timer. Some firmware sends these state
 * events as `action=Pulse` with no matching Stop, and a boolean that latches on
 * one of those would read "tamper detected" until the plugin restarts — a worse
 * failure than missing the event.
 */
export class CodeLatch {
  private readonly active = new Map<string, NodeJS.Timeout | undefined>();

  constructor(
    private readonly onChange: (detected: boolean) => void,
    private readonly pulseTimeoutMs = DEFAULT_PULSE_TIMEOUT_MS,
  ) {}

  /** Start/Stop activation. A Start cancels any pulse expiry pending for the code. */
  report(code: string, active: boolean): void {
    this.clearTimer(code);
    if (active) this.active.set(code, undefined);
    else this.active.delete(code);
    this.emit();
  }

  /** Momentary activation, expired on a timer. A repeat pulse resets the expiry. */
  pulse(code: string): void {
    this.clearTimer(code);
    const timer = setTimeout(() => {
      // Only expire if the code is still pulse-owned; a Start in the meantime
      // replaces the entry and clears this timer.
      if (this.active.get(code) !== timer) return;
      this.active.delete(code);
      this.emit();
    }, this.pulseTimeoutMs);
    timer.unref?.();
    this.active.set(code, timer);
    this.emit();
  }

  /** The codes currently holding the sensor up, for logging. */
  get codes(): string[] {
    return [...this.active.keys()];
  }

  /** Cancels pending expiries so a destroyed camera leaves no timers behind. */
  destroy(): void {
    for (const code of this.active.keys()) this.clearTimer(code);
    this.active.clear();
  }

  private clearTimer(code: string): void {
    const timer = this.active.get(code);
    if (timer) clearTimeout(timer);
  }

  private emit(): void {
    this.onChange(this.active.size > 0);
  }
}
