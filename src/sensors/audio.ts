import { AudioSensor } from '@camera.ui/sdk';

export class AmcrestAudioSensor extends AudioSensor {
  constructor() {
    super('Amcrest Audio');
  }

  report(active: boolean): void {
    this.reportDetections(active);
  }
}
