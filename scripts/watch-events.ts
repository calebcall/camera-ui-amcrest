/**
 * Tails a camera's native event stream and prints how the plugin classifies
 * each event. Useful for finding event codes the plugin doesn't handle yet.
 *
 *   npm run watch-events -- --ip 192.168.1.50 --user admin --pass secret
 *
 * Credentials may also come from AMCREST_IP / AMCREST_USER / AMCREST_PASS.
 */
import { parseArgs } from 'node:util';

import { AmcrestClient } from '../src/amcrest/api.js';
import { classifyAmcrestEvent } from '../src/amcrest/classify.js';
import {
  detectBoundary,
  extractCompleteEvents,
} from '../src/amcrest/event-reader.js';
import { parseAmcrestEvent } from '../src/amcrest/events.js';

const { values } = parseArgs({
  options: {
    ip: { type: 'string' },
    user: { type: 'string' },
    pass: { type: 'string' },
    port: { type: 'string' },
  },
});

const ip = values.ip ?? process.env.AMCREST_IP;
const username = values.user ?? process.env.AMCREST_USER;
const password = values.pass ?? process.env.AMCREST_PASS;

if (!ip || !username || !password) {
  console.error(
    'Usage: npm run watch-events -- --ip <address> --user <username> --pass <password> [--port <httpPort>]',
  );
  process.exit(1);
}

const client = new AmcrestClient({
  ip,
  username,
  password,
  httpPort: values.port ? Number(values.port) : undefined,
});

function stamp(): string {
  return new Date().toISOString().substring(11, 19);
}

function describe(blob: string): string | undefined {
  const ev = parseAmcrestEvent(blob);
  if (!ev) return undefined;

  const c = classifyAmcrestEvent(ev);
  const head = `${stamp()}  ${ev.code.padEnd(24)} action=${ev.action}`;
  if (!c) return `${head}  -> UNHANDLED`;
  if (c.kind !== 'object') return `${head}  -> ${c.kind}`;

  const parts = [c.category, c.active ? 'active' : 'clear'];
  if (c.momentary) parts.push('momentary');
  if (c.detection) {
    const b = c.detection.box;
    parts.push(
      `box=[${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.width.toFixed(3)}, ${b.height.toFixed(3)}]`,
    );
    if (c.detection.trackId !== undefined)
      parts.push(`track=${c.detection.trackId}`);
  }
  return `${head}  -> object ${parts.join(' ')}`;
}

const abort = new AbortController();
process.on('SIGINT', () => {
  abort.abort();
  process.exit(0);
});

console.log(`Watching ${ip} — trigger events on the camera. Ctrl-C to stop.\n`);

try {
  const stream = await client.attachEvents(abort.signal);
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const boundary = detectBoundary(buffer);
    if (!boundary) continue;
    const { blobs, rest } = extractCompleteEvents(buffer, boundary);
    for (const blob of blobs) {
      const line = describe(blob);
      if (line) console.log(line);
    }
    buffer = rest;
  }
  console.error('Event stream closed by the camera.');
} catch (error) {
  console.error(
    `Could not read the event stream: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
