import { PTZCapability, PTZControl } from '@camera.ui/sdk';

import { ptzCommandForVelocity } from '../amcrest/ptz-commands.js';
import { gotoPresetCommand } from '../amcrest/ptz-presets.js';

import type { AmcrestClient } from '../amcrest/api.js';
import type { PtzPreset } from '../amcrest/ptz-presets.js';
import type { PTZDirection } from '@camera.ui/sdk';

export class AmcrestPTZSensor extends PTZControl {
  /**
   * Code of the move the camera is running, so the stop can name it. The
   * firmware ignores a stop for any other code.
   */
  private activeCode?: string;

  /** Preset number for each published preset name. */
  private presetIndex = new Map<string, number>();

  constructor(
    private readonly client: AmcrestClient,
    private readonly channel: number,
    name = 'Amcrest PTZ',
  ) {
    super(name);
  }

  setCapabilities(
    pan: boolean,
    tilt: boolean,
    zoom: boolean,
    presets = false,
  ): void {
    const caps: PTZCapability[] = [PTZCapability.VelocityControl];
    if (pan) caps.push(PTZCapability.Pan);
    if (tilt) caps.push(PTZCapability.Tilt);
    if (zoom) caps.push(PTZCapability.Zoom);
    if (presets) caps.push(PTZCapability.Presets);
    this.capabilities = caps;
  }

  /** Publish the camera's presets; names must already be unique. */
  loadPresets(presets: PtzPreset[]): void {
    this.presetIndex = new Map(presets.map((p) => [p.name, p.index]));
    this.setPresets(presets.map((p) => p.name));
  }

  override async setTargetPreset(name: string | undefined): Promise<void> {
    if (name === undefined) return;
    const index = this.presetIndex.get(name);
    if (index === undefined) return;
    try {
      // A preset move does not cancel a running continuous move.
      await this.stopActiveMove();
      await this.client.sendPtzCommand(this.channel, gotoPresetCommand(index));
      await super.setTargetPreset(name);
    } catch {
      // Non-fatal; a failed PTZ command should not crash the camera controller.
    }
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
        if (this.activeCode !== cmd.code) await this.stopActiveMove();
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

  private async stopActiveMove(): Promise<void> {
    if (!this.activeCode) return;
    const code = this.activeCode;
    this.activeCode = undefined;
    await this.client.sendPtzCommand(this.channel, {
      action: 'stop',
      code,
      arg2: 0,
    });
  }
}
