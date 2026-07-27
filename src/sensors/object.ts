import { ObjectSensor } from '@camera.ui/sdk';

import type { AmcrestDetection } from '../amcrest/classify.js';
import type { TrackedDetection } from '@camera.ui/sdk';

type ObjectCategory = 'person' | 'vehicle';

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

/** How long a pulse-activated category stays reported before self-clearing. */
const DEFAULT_PULSE_TIMEOUT_MS = 5000;

interface ActiveCategory {
  /** Every object the triggering event described; empty when it carried none. */
  detections: AmcrestDetection[];
  /** Set only for pulse-activated categories; Start/Stop categories have none. */
  timer?: NodeJS.Timeout;
}

export class AmcrestObjectSensor extends ObjectSensor {
  private active = new Map<ObjectCategory, ActiveCategory>();

  constructor(private readonly pulseTimeoutMs = DEFAULT_PULSE_TIMEOUT_MS) {
    super('Amcrest Object');
  }

  /**
   * Start/Stop activation. A `Start` takes ownership of the category, cancelling
   * any pulse expiry still pending for it.
   */
  report(
    category: ObjectCategory,
    detected: boolean,
    detections: AmcrestDetection[] = [],
  ): void {
    this.clearTimer(category);
    if (detected) {
      this.active.set(category, { detections });
    } else {
      this.active.delete(category);
    }
    this.emit();
  }

  /**
   * Momentary activation for `action=Pulse` events (commonly `FaceDetection`,
   * and line crossing on some firmwares). These never get a matching `Stop`, so
   * the category is expired on a timer instead. A repeat pulse resets it.
   */
  pulse(category: ObjectCategory, detections: AmcrestDetection[] = []): void {
    this.clearTimer(category);
    const timer = setTimeout(() => {
      const entry = this.active.get(category);
      // Only expire if the category is still pulse-owned; a Start in the
      // meantime replaces the entry and clears this timer.
      if (entry?.timer !== timer) return;
      this.active.delete(category);
      this.emit();
    }, this.pulseTimeoutMs);
    timer.unref?.();
    this.active.set(category, { detections, timer });
    this.emit();
  }

  /** Cancels pending pulse expiries so a destroyed camera leaves no timers behind. */
  destroy(): void {
    for (const category of this.active.keys()) this.clearTimer(category);
    this.active.clear();
  }

  private clearTimer(category: ObjectCategory): void {
    const timer = this.active.get(category)?.timer;
    if (timer) clearTimeout(timer);
  }

  private emit(): void {
    if (this.active.size === 0) {
      this.reportDetections(false);
      return;
    }

    // Smart events carry a real box per object; codes that carry no coordinates
    // at all (e.g. VideoMotion) fall back to a single full-frame detection so
    // the category still shows up as a label. Confidence is not usable across
    // models (0 on some, 0-100 on others), so it is reported as certain.
    const detections: TrackedDetection[] = Array.from(this.active).flatMap(
      ([label, entry]) =>
        entry.detections.length > 0
          ? entry.detections.map((d) => ({
              label,
              confidence: 1,
              box: d.box,
              ...(d.trackId !== undefined ? { trackId: d.trackId } : {}),
            }))
          : [{ label, confidence: 1, box: FULL_FRAME }],
    );
    this.reportDetections(true, detections);
  }
}
