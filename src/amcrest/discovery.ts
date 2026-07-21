// Dahua DHIP UDP discovery.
//
// The probe/response byte format below (32-byte little-endian header + JSON
// body) is based on the *documented* Dahua DHIP discovery protocol, not a
// packet capture from real hardware. It has NOT been validated against an
// actual Amcrest/Dahua device. Task 15 (hardware validation) MUST capture a
// real discovery exchange (e.g. via `tcpdump -i any -X 'udp port 37810'`) and
// adjust the header fields / JSON field paths here to match the real bytes
// before this is relied upon in production.

import { createSocket } from 'node:dgram';

export interface DiscoveredAmcrest {
  ip: string;
  mac?: string;
  deviceType?: string;
}

const MCAST_ADDR = '239.255.255.251';
const MCAST_PORT = 37810;

export function buildDiscoveryProbe(): Buffer {
  const body = Buffer.from(
    JSON.stringify({
      method: 'DHDiscover.search',
      params: { mac: '', uni: 1 },
    }),
    'utf8',
  );
  const header = Buffer.alloc(32);
  header.writeUInt8(0x20, 0);
  header.writeUInt8(0x00, 1);
  header.writeUInt32LE(body.length, 4);
  header.writeUInt32LE(body.length, 12);
  // NOTE: unvalidated against a real capture — see the file-level comment above.
  return Buffer.concat([header, body]);
}

export function parseDiscoveryResponse(
  buf: Buffer,
): DiscoveredAmcrest | undefined {
  const start = buf.indexOf(0x7b); // '{'
  const end = buf.lastIndexOf(0x7d); // '}'
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    const json = JSON.parse(buf.subarray(start, end + 1).toString('utf8')) as {
      params?: {
        deviceInfo?: {
          IPv4Address?: { IPAddress?: string };
          DeviceType?: string;
          PhysicalAddress?: string;
        };
      };
    };
    const info = json.params?.deviceInfo;
    const ip = info?.IPv4Address?.IPAddress;
    if (!ip) return undefined;
    return { ip, mac: info?.PhysicalAddress, deviceType: info?.DeviceType };
  } catch {
    return undefined;
  }
}

export async function discover(
  timeoutMs: number,
  logger: { debug: (...a: unknown[]) => void },
): Promise<DiscoveredAmcrest[]> {
  return new Promise((resolvePromise) => {
    const found = new Map<string, DiscoveredAmcrest>();
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    let finished = false;

    // Scheduled up front (not inside socket.bind's callback) so discover()
    // always resolves even if bind() never calls back and never errors.
    const timer = setTimeout(finish, timeoutMs);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolvePromise(Array.from(found.values()));
    }

    socket.on('error', (err) => {
      logger.debug('Amcrest discovery socket error:', err);
      finish();
    });

    socket.on('message', (msg) => {
      const parsed = parseDiscoveryResponse(msg);
      if (parsed) found.set(parsed.ip, parsed);
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        const probe = buildDiscoveryProbe();
        socket.send(probe, MCAST_PORT, MCAST_ADDR);
        socket.send(probe, MCAST_PORT, '255.255.255.255');
      } catch (err) {
        logger.debug('Amcrest discovery send failed:', err);
      }
    });
  });
}
