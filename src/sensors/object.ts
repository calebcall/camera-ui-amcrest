import { ObjectSensor } from '@camera.ui/sdk';

import type { TrackedDetection } from '@camera.ui/sdk';

type ObjectCategory = 'person' | 'vehicle';

export class AmcrestObjectSensor extends ObjectSensor {
  private active = new Set<ObjectCategory>();

  constructor() {
    super('Amcrest Object');
  }

  report(category: ObjectCategory, detected: boolean): void {
    if (detected) {
      this.active.add(category);
    } else {
      this.active.delete(category);
    }

    if (this.active.size === 0) {
      this.reportDetections(false);
      return;
    }

    // Amcrest smart events lack usable normalized boxes — synthesize a full-frame detection per category for labels.
    const detections: TrackedDetection[] = Array.from(this.active).map(
      (label) => ({
        label,
        confidence: 1,
        box: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
    this.reportDetections(true, detections);
  }
}
