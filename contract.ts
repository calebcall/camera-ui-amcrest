import { PluginInterface, PluginRole, SensorType } from '@camera.ui/sdk';

import type { PluginContract } from '@camera.ui/sdk';

export const contract: PluginContract = {
  name: 'Amcrest',
  role: PluginRole.CameraController,
  provides: [SensorType.Motion, SensorType.Object, SensorType.Audio, SensorType.Doorbell, SensorType.PTZ],
  consumes: [],
  interfaces: [PluginInterface.DiscoveryProvider],
};

export default contract;
