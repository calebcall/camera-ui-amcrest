import { ObjectSensor } from '@camera.ui/sdk';

import type { AmcrestDetection } from '../amcrest/classify.js';
import type { TrackedDetection } from '@camera.ui/sdk';

type ObjectCategory = 'person' | 'vehicle';

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

/** How long a pulse-activated category stays reported before self-clearing. */
const DEFAULT_PULSE_TIMEOUT_MS = 5000;

interface ActiveCategory {
  detection?: AmcrestDetection;
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
    detection?: AmcrestDetection,
  ): void {
    this.clearTimer(category);
    if (detected) {
      this.active.set(category, { detection });
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
  pulse(category: ObjectCategory, detection?: AmcrestDetection): void {
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
    this.active.set(category, { detection, timer });
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

    // Smart events (CrossLine/CrossRegion/FaceDetection) carry a real box; the
    // plain motion codes carry no coordinates, so those fall back to full frame.
    // Confidence is not usable across models (0 on some, 0-100 on others), so
    // it is reported as certain rather than mapped.
    const detections: TrackedDetection[] = Array.from(this.active).map(
      ([label, entry]) => ({
        label,
        confidence: 1,
        box: entry.detection?.box ?? FULL_FRAME,
        ...(entry.detection?.trackId !== undefined
          ? { trackId: entry.detection.trackId }
          : {}),
      }),
    );
    this.reportDetections(true, detections);
  }
}
