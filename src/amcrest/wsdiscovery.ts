// ONVIF WS-Discovery (SOAP over UDP multicast, 239.255.255.250:3702).
//
// Many Amcrest units answer ONVIF WS-Discovery but NOT the Dahua DHIP probe
// (see discovery.ts), so this is the primary discovery mechanism. It is kept
// dependency-free (no ONVIF library) so the plugin stays self-contained.

import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

export interface WsDiscovered {
  ip: string;
  manufacturer?: string;
  name?: string;
  hardware?: string;
  scopes: string[];
}

const WSD_ADDR = '239.255.255.250';
const WSD_PORT = 3702;

// Amcrest/Dahua hardware/name prefixes seen in ONVIF scopes, used as a fallback
// when the manufacturer scope is absent or generic.
const AMCREST_HW_RE = /^(ip[0-9]|ipc|ip2m|ip3m|ip4m|ip5m|ip8m|ad[0-9]|amc|ash|asd|dh-|dahua)/i;

export function buildWsDiscoveryProbe(messageId: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"' +
    ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"' +
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"' +
    ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
    '<e:Header>' +
    `<w:MessageID>urn:uuid:${messageId}</w:MessageID>` +
    '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
    '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>' +
    '</e:Header>' +
    '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>' +
    '</e:Envelope>'
  );
}

// Extract the text content of the first element whose local name matches `tag`,
// ignoring any XML namespace prefix.
function firstTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<[A-Za-z0-9_.]*:?${tag}[^>]*>([\\s\\S]*?)</[A-Za-z0-9_.]*:?${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : undefined;
}

export function scopeValue(scopes: string[], key: string): string | undefined {
  const prefix = `onvif://www.onvif.org/${key}/`.toLowerCase();
  const s = scopes.find((x) => x.toLowerCase().startsWith(prefix));
  if (!s) return undefined;
  try {
    return decodeURIComponent(s.substring(prefix.length));
  } catch {
    return s.substring(prefix.length);
  }
}

export function isAmcrestDevice(scopes: string[]): boolean {
  const blob = scopes.join(' ').toLowerCase();
  if (blob.includes('amcrest') || blob.includes('dahua')) return true;
  const hardware = scopeValue(scopes, 'hardware');
  if (hardware && AMCREST_HW_RE.test(hardware)) return true;
  const name = scopeValue(scopes, 'name');
  if (name && AMCREST_HW_RE.test(name)) return true;
  return false;
}

export function parseWsProbeMatch(xml: string): WsDiscovered | undefined {
  const xaddrs = firstTag(xml, 'XAddrs');
  const scopesRaw = firstTag(xml, 'Scopes');
  if (!xaddrs && !scopesRaw) return undefined;

  let ip: string | undefined;
  if (xaddrs) {
    const urlMatch = /https?:\/\/([^/:\s]+)/i.exec(xaddrs);
    if (urlMatch) ip = urlMatch[1];
  }
  if (!ip) return undefined;

  const scopes = scopesRaw ? scopesRaw.split(/\s+/).filter(Boolean) : [];
  return {
    ip,
    manufacturer: scopeValue(scopes, 'manufacturer'),
    name: scopeValue(scopes, 'name'),
    hardware: scopeValue(scopes, 'hardware'),
    scopes,
  };
}

export interface WsDiscoveryLogger {
  debug: (...a: unknown[]) => void;
  log: (...a: unknown[]) => void;
}

const PROBE_RESEND_MS = 1200;
// Only sweep reasonably small subnets (>= /22 => <= 1022 hosts) to avoid a huge
// packet fan-out on large/misconfigured networks.
const MIN_SWEEP_PREFIX = 22;

interface LocalIface {
  address: string;
  cidr: string | null;
}

function localIPv4Interfaces(): LocalIface[] {
  const nifs = networkInterfaces();
  const out: LocalIface[] = [];
  for (const list of Object.values(nifs)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ address: ni.address, cidr: ni.cidr });
    }
  }
  return out;
}

// Enumerate host addresses of a subnet given as "10.1.126.179/24".
// Excludes the network and broadcast addresses. Returns [] for subnets larger
// than MIN_SWEEP_PREFIX or unparseable input.
export function subnetHosts(cidr: string | null): string[] {
  if (!cidr) return [];
  const [addr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!addr || !Number.isInteger(prefix) || prefix < MIN_SWEEP_PREFIX || prefix > 32) return [];

  const ipToInt = (ip: string): number => ip.split('.').reduce((acc, o) => ((acc << 8) | (Number(o) & 255)) >>> 0, 0);
  const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const base = ipToInt(addr) & mask;
  const total = 2 ** (32 - prefix);
  const hosts: string[] = [];
  for (let i = 1; i < total - 1; i++) hosts.push(intToIp((base + i) >>> 0));
  return hosts;
}

export async function discoverWs(timeoutMs: number, logger: WsDiscoveryLogger): Promise<WsDiscovered[]> {
  return new Promise((resolvePromise) => {
    const found = new Map<string, WsDiscovered>();
    const seen = new Set<string>();
    const sockets: ReturnType<typeof createSocket>[] = [];
    const senders: (() => void)[] = [];
    const cleanups: (() => void)[] = [];
    let finished = false;

    // Probe from every non-internal IPv4 interface; a single default-interface
    // probe misses cameras reachable only via another NIC/VLAN/bridge.
    const ifaces = localIPv4Interfaces();
    logger.log(
      `WS-Discovery: probing ${ifaces.length} interface(s): ${ifaces.length ? ifaces.map((i) => i.cidr ?? i.address).join(', ') : '(default only)'}`,
    );
    const bindTargets: LocalIface[] = ifaces.length ? ifaces : [{ address: '', cidr: null }];

    const timer = setTimeout(finish, timeoutMs);
    cleanups.push(() => clearTimeout(timer));

    function finish() {
      if (finished) return;
      finished = true;
      for (const c of cleanups) c();
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          // ignore
        }
      }
      resolvePromise(Array.from(found.values()));
    }

    function handleMessage(msg: Buffer, rinfo: { address: string }) {
      const src = rinfo.address;
      const device = parseWsProbeMatch(msg.toString('utf8'));
      if (!device) {
        // Diagnostic: a reply we received but could not parse (unexpected format).
        if (!seen.has(src)) {
          seen.add(src);
          const snippet = msg.toString('utf8').slice(0, 200).replace(/\s+/g, ' ');
          logger.log(`WS-Discovery: unparsed reply from ${src} (len=${msg.length}): ${snippet}`);
        }
        return;
      }
      if (seen.has(device.ip)) return;
      seen.add(device.ip);
      const amcrest = isAmcrestDevice(device.scopes);
      const mfr = device.manufacturer ?? '?';
      const name = device.name ?? '?';
      const hw = device.hardware ?? '?';
      logger.log(`WS-Discovery: ip=${device.ip} (via ${src}) manufacturer=${mfr} name=${name} hardware=${hw} amcrest=${amcrest}`);
      if (amcrest) {
        found.set(device.ip, device);
      }
    }

    for (const iface of bindTargets) {
      const addr = iface.address || undefined;
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      // One socket failing (e.g. bind conflict) must not abort the whole scan.
      socket.on('error', (err) => logger.debug(`WS-Discovery socket error (${addr ?? '*'}):`, err));
      socket.on('message', handleMessage);
      socket.bind(addr ? { address: addr, port: 0 } : { port: 0 }, () => {
        try {
          socket.setBroadcast(true);
          if (addr) socket.setMulticastInterface(addr);
        } catch (err) {
          logger.debug(`WS-Discovery setup failed (${addr ?? '*'}):`, err);
        }

        const send = (target: string) => {
          try {
            socket.send(Buffer.from(buildWsDiscoveryProbe(randomUUID()), 'utf8'), WSD_PORT, target);
          } catch (err) {
            logger.debug(`WS-Discovery send failed (${addr ?? '*'} -> ${target}):`, err);
          }
        };

        // Unicast sweep of this interface's subnet: every ONVIF device replies
        // unicast to our ephemeral port, so we never depend on multicast-group
        // replies or share port 3702 with the ONVIF plugin. Sent once.
        const hosts = subnetHosts(iface.cidr).filter((h) => h !== iface.address);
        if (hosts.length) {
          logger.log(`WS-Discovery: unicast sweep of ${iface.cidr} (${hosts.length} hosts)`);
          for (const h of hosts) send(h);
        }

        // Also multicast (repeated) for anything the sweep can't reach.
        senders.push(() => send(WSD_ADDR));
      });
    }

    // Resend the multicast probe across the window (dedup handles repeats); the
    // first tick gives the per-interface binds time to register their senders.
    const sendAll = () => senders.forEach((s) => s());
    const firstSend = setTimeout(sendAll, 100);
    const resend = setInterval(sendAll, PROBE_RESEND_MS);
    cleanups.push(() => clearTimeout(firstSend), () => clearInterval(resend));
  });
}
