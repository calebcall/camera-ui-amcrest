export interface AmcrestSystemInfo {
  deviceType?: string;
  hardwareVersion?: string;
  serialNumber?: string;
}

export function parseKeyValueBody(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let idx = line.indexOf('=');
    if (idx === -1) idx = line.length;
    out[line.substring(0, idx)] = line.substring(idx + 1).trim();
  }
  return out;
}

export function parseSystemInfo(text: string): AmcrestSystemInfo {
  const kv = parseKeyValueBody(text);
  const info: AmcrestSystemInfo = {
    deviceType: kv.deviceType || undefined,
    hardwareVersion: kv.hardwareVersion || undefined,
    serialNumber: kv.serialNumber || undefined,
  };
  if (!info.deviceType && !info.hardwareVersion && !info.serialNumber) {
    throw new Error('not amcrest');
  }
  return info;
}
