import { PTZCapability, PTZControl } from '@camera.ui/sdk';

import { ptzCommandForVelocity } from '../amcrest/ptz-commands.js';

import type { AmcrestClient } from '../amcrest/api.js';
import type { PTZDirection } from '@camera.ui/sdk';

export class AmcrestPTZSensor extends PTZControl {
  /**
   * Code of the move the camera is running, so the stop can name it. The
   * firmware ignores a stop for any other code.
   */
  private activeCode?: string;

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

  override async setVelocity(
    velocity: PTZDirection | undefined,
  ): Promise<void> {
    if (!velocity) return;
    try {
      const cmd = ptzCommandForVelocity(velocity, this.activeCode);
      if (cmd.action === 'start') {
        // A new direction does not cancel the old one (zoom keeps running
        // under a pan), so stop the running move first.
        if (this.activeCode && this.activeCode !== cmd.code) {
          await this.client.sendPtzCommand(this.channel, {
            action: 'stop',
            code: this.activeCode,
            arg2: 0,
          });
        }
        await this.client.sendPtzCommand(this.channel, cmd);
        this.activeCode = cmd.code;
      } else {
        await this.client.sendPtzCommand(this.channel, cmd);
        this.activeCode = undefined;
      }
      await super.setVelocity(velocity);
    } catch {
      // Non-fatal; a failed PTZ command should not crash the camera controller.
    }
  }
}
