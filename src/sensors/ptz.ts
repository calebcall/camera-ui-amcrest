import { PTZCapability, PTZControl } from '@camera.ui/sdk';

import type { AmcrestClient } from '../amcrest/api.js';
import type { PTZDirection } from '@camera.ui/sdk';

export class AmcrestPTZSensor extends PTZControl {
  constructor(
    private readonly client: AmcrestClient,
    private readonly channel: number,
    name = 'Amcrest PTZ',
  ) {
    super(name);
  }

  setCapabilities(pan: boolean, tilt: boolean, zoom: boolean): void {
    const caps: PTZCapability[] = [PTZCapability.VelocityControl];
    if (pan) caps.push(PTZCapability.Pan);
    if (tilt) caps.push(PTZCapability.Tilt);
    if (zoom) caps.push(PTZCapability.Zoom);
    this.capabilities = caps;
  }

  override async setVelocity(velocity: PTZDirection | undefined): Promise<void> {
    if (!velocity) return;
    try {
      await this.client.ptz(this.channel, {
        panSpeed: velocity.panSpeed,
        tiltSpeed: velocity.tiltSpeed,
        zoomSpeed: velocity.zoomSpeed,
      });
      await super.setVelocity(velocity);
    } catch {
      // Non-fatal; a failed PTZ command should not crash the camera controller.
    }
  }
}
