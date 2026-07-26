import { ObjectSensor } from '@camera.ui/sdk';

import type { AmcrestDetection } from '../amcrest/classify.js';
import type { TrackedDetection } from '@camera.ui/sdk';

type ObjectCategory = 'person' | 'vehicle';

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

export class AmcrestObjectSensor extends ObjectSensor {
  /** Active categories mapped to the last box the camera sent for them, if any. */
  private active = new Map<ObjectCategory, AmcrestDetection | undefined>();

  constructor() {
    super('Amcrest Object');
  }

  report(
    category: ObjectCategory,
    detected: boolean,
    detection?: AmcrestDetection,
  ): void {
    if (detected) {
      this.active.set(category, detection);
    } else {
      this.active.delete(category);
    }

    if (this.active.size === 0) {
      this.reportDetections(false);
      return;
    }

    // Smart events (CrossLine/CrossRegion/FaceDetection) carry a real box; the
    // plain motion codes carry no coordinates, so those fall back to full frame.
    // Confidence is not usable across models (0 on some, 0-100 on others), so
    // it is reported as certain rather than mapped.
    const detections: TrackedDetection[] = Array.from(this.active).map(
      ([label, det]) => ({
        label,
        confidence: 1,
        box: det?.box ?? FULL_FRAME,
        ...(det?.trackId !== undefined ? { trackId: det.trackId } : {}),
      }),
    );
    this.reportDetections(true, detections);
  }
}
