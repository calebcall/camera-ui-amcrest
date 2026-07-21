import { Buffer } from 'node:buffer';

import { digestFetch } from './digest-auth.js';
import { parseEncodeConfig } from './encode-config.js';
import { ptzCommandForVelocity } from './ptz-commands.js';
import { buildRtspUrl } from './rtsp-url.js';
import { parseSystemInfo } from './system-info.js';

import type { AmcrestStream } from './encode-config.js';
import type { PtzVelocity } from './ptz-commands.js';
import type { AmcrestSystemInfo } from './system-info.js';

export interface AmcrestClientOptions {
  ip: string;
  username: string;
  password: string;
  port?: number; // RTSP port
  httpPort?: number; // CGI/HTTP port
}

// Thrown when the device rejects the credentials (HTTP 401 after digest auth).
export class AmcrestAuthError extends Error {
  constructor(message = 'Authentication failed — check the username and password') {
    super(message);
    this.name = 'AmcrestAuthError';
  }
}

export class AmcrestClient {
  constructor(private readonly opts: AmcrestClientOptions) {}

  urlFor(pathAndQuery: string): string {
    const host = this.opts.httpPort && this.opts.httpPort !== 80 ? `${this.opts.ip}:${this.opts.httpPort}` : this.opts.ip;
    return `http://${host}${pathAndQuery}`;
  }

  private async fetch(pathAndQuery: string, init?: { method?: string; headers?: Record<string, string>; body?: BodyInit; signal?: AbortSignal }): Promise<Response> {
    const res = await digestFetch({
      url: this.urlFor(pathAndQuery),
      username: this.opts.username,
      password: this.opts.password,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
    // A final 401 (after the digest handshake) means the credentials are wrong.
    // Surface it clearly instead of letting callers misread the 401 body (e.g.
    // getSystemInfo would otherwise throw the misleading 'not amcrest').
    if (res.status === 401) {
      await res.arrayBuffer().catch(() => undefined);
      throw new AmcrestAuthError();
    }
    return res;
  }

  rtspUrl(channel: number, subtype: number): string {
    return buildRtspUrl({ ip: this.opts.ip, username: this.opts.username, password: this.opts.password, port: this.opts.port, channel, subtype });
  }

  async getSystemInfo(): Promise<AmcrestSystemInfo> {
    const res = await this.fetch('/cgi-bin/magicBox.cgi?action=getSystemInfo');
    return parseSystemInfo(await res.text());
  }

  async getStreams(channel: number): Promise<AmcrestStream[]> {
    const res = await this.fetch('/cgi-bin/configManager.cgi?action=getConfig&name=Encode');
    return parseEncodeConfig(await res.text(), channel);
  }

  async snapshot(channel: number, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.fetch(`/cgi-bin/snapshot.cgi?channel=${channel}`, { signal });
    return Buffer.from(await res.arrayBuffer());
  }

  async ptz(channel: number, v: PtzVelocity): Promise<void> {
    const cmd = ptzCommandForVelocity(v);
    const q = `/cgi-bin/ptz.cgi?action=${cmd.action}&channel=${channel}&code=${cmd.code}&arg1=0&arg2=${cmd.arg2}&arg3=0`;
    await this.fetch(q);
  }

  async getPtzCaps(channel: number): Promise<string> {
    const res = await this.fetch(`/cgi-bin/ptz.cgi?action=getCurrentProtocolCaps&channel=${channel}`);
    return await res.text();
  }

  async attachEvents(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    // heartbeat=N makes the camera emit periodic keep-alives, so the long-lived
    // stream keeps receiving data and undici's ~5min body timeout
    // (UND_ERR_BODY_TIMEOUT) never fires on cameras that are idle between events.
    const res = await this.fetch('/cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=30', { signal });
    if (!res.body) {
      throw new Error('event stream has no body');
    }
    return res.body;
  }
}
