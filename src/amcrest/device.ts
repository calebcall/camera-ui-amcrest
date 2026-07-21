export type AmcrestDeviceFamily = 'amcrest' | 'dahua';

export interface DeviceClassification {
  isDoorbell: boolean;
  family: AmcrestDeviceFamily;
}

// Single source of truth for device-type based classification, shared by doorbell
// detection (camera.ts) and talkback codec selection (talkback.ts) so the two never
// disagree about which family a given deviceType string belongs to.
export function classifyDevice(
  deviceType: string | undefined,
): DeviceClassification {
  const dt = (deviceType ?? '').toUpperCase();

  const family: AmcrestDeviceFamily =
    dt.startsWith('DH-') || dt.startsWith('DB') || dt.includes('VTO')
      ? 'dahua'
      : 'amcrest';
  const isDoorbell =
    dt.startsWith('AD') || dt.includes('VTO') || dt.includes('DB');

  return { isDoorbell, family };
}
