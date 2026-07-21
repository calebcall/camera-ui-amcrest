import { PassThrough } from 'node:stream';

import { AvSource, BackchannelTranscoder, Relay } from '@seydx/rtsp';

import { AmcrestClient } from './amcrest/api.js';
import { classifyAmcrestEvent } from './amcrest/classify.js';
import { classifyDevice } from './amcrest/device.js';
import { digestFetch } from './amcrest/digest-auth.js';
import { extractCompleteEvents } from './amcrest/event-reader.js';
import { parseAmcrestEvent } from './amcrest/events.js';
import { selectTalkbackTarget } from './amcrest/talkback.js';
import { AmcrestAudioSensor, AmcrestDoorbellTrigger, AmcrestMotionSensor, AmcrestObjectSensor, AmcrestPTZSensor } from './sensors/index.js';

import type { AmcrestCapabilities, AmcrestCameraStorage, AmcrestInitialSettings } from './types.js';
import type { CameraDevice, DeviceStorage, LoggerService, SnapshotInterface, StreamingInterface } from '@camera.ui/sdk';
import type { Logger, RtspServerSink } from '@seydx/rtsp';

// Advertised to RTSP viewers as the backchannel codec and, reused verbatim, as the
// BackchannelTranscoder's inbound ("from") format — the shapes are identical.
const BACKCHANNEL_ADVERTISE = { codec: 'pcm_alaw', payloadType: 8, clockRate: 8000, channels: 1 } as const;
const EVENT_RECONNECT_BASE_MS = 2000;
const EVENT_RECONNECT_MAX_MS = 30000;

class Implementations implements StreamingInterface, SnapshotInterface {
  constructor(private readonly cam: AmcrestCamera) {}
  async streamUrl(): Promise<string> {
    return this.cam.getStreamUrl();
  }

  async snapshot(): Promise<ArrayBuffer | undefined> {
    return this.cam.getSnapshot();
  }
}

export class AmcrestCamera {
  // Built in initialize(), once real connection settings are known (either freshly
  // persisted from adoption, or already present in storage on a restart). Never
  // built from the constructor's empty storage — see initialize() for why.
  private client!: AmcrestClient;
  private readonly storage: DeviceStorage<AmcrestCameraStorage>;
  private readonly log: LoggerService;

  private relay?: Relay;
  private rtspServer?: RtspServerSink;
  private relayLogger?: Logger;
  private transcoder?: BackchannelTranscoder;
  private transcoderStarting?: Promise<void>;
  private talkbackBody?: PassThrough;

  private motion?: AmcrestMotionSensor;
  private object?: AmcrestObjectSensor;
  private audio?: AmcrestAudioSensor;
  private doorbell?: AmcrestDoorbellTrigger;
  private ptz?: AmcrestPTZSensor;

  private eventAbort?: AbortController;
  private eventReconnectStreak = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;

  private capabilities: AmcrestCapabilities = {
    deviceType: undefined,
    doorbell: false,
    ptz: false,
    ptzPan: false,
    ptzTilt: false,
    ptzZoom: false,
  };

  constructor(private readonly cameraDevice: CameraDevice) {
    this.log = cameraDevice.logger;
    this.storage = this.createStorage();
  }

  async initialize(initialSettings?: AmcrestInitialSettings): Promise<void> {
    // Bridge for the adoption flow: the SDK only persists the CameraConfig returned
    // from onAdoptCamera, not the settings form fields (ip/username/password/...), so
    // the plugin hands them to us here to apply and persist to storage ourselves.
    if (initialSettings) {
      this.storage.values.ip = initialSettings.ip;
      this.storage.values.username = initialSettings.username;
      this.storage.values.password = initialSettings.password;
      if (initialSettings.channel !== undefined) this.storage.values.channel = initialSettings.channel;
      if (initialSettings.port !== undefined) this.storage.values.port = initialSettings.port;
      if (initialSettings.httpPort !== undefined) this.storage.values.httpPort = initialSettings.httpPort;
      await this.storage.save();
    }

    const v = this.storage.values;
    if (!v.ip || !v.username || !v.password) {
      this.cameraDevice.logger.attention('Please configure the Amcrest connection settings');
      return;
    }

    // Built here, after settings are confirmed present (and persisted, if this is a
    // fresh adoption) — never in the constructor, where storage.values would still be
    // empty on a brand-new adoption.
    this.client = new AmcrestClient({ ip: v.ip, username: v.username, password: v.password, port: v.port, httpPort: v.httpPort });

    this.capabilities = await this.detectCapabilities();
    await this.setupStreaming();
    await this.cameraDevice.implement(new Implementations(this));
    await this.setupSensors();
    this.startEventLoop();
    this.cameraDevice.connect();
  }

  async getStreamUrl(): Promise<string> {
    // Only reachable once implement() has registered Implementations, which happens
    // after this.client is built in initialize() — but guard anyway in case the SDK
    // calls in from an unexpected path.
    if (!this.client) {
      throw new Error('Amcrest camera is not configured');
    }
    if (this.rtspServer) return `${this.rtspServer.url}#timeout=30`;
    // Fallback: direct RTSP (no backchannel) if relay unavailable.
    return this.client.rtspUrl(this.channel, 0);
  }

  async getSnapshot(): Promise<ArrayBuffer | undefined> {
    if (!this.client) return undefined;
    try {
      const buf = await this.client.snapshot(this.channel);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch (error) {
      this.log.error('Snapshot failed:', error);
      return undefined;
    }
  }

  destroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.eventAbort?.abort();
    this.resetTalkback();
    void this.rtspServer?.shutdown();
    void this.relay?.stop();
    this.log.log('Amcrest camera destroyed:', this.cameraDevice.name);
  }

  private get channel(): number {
    return this.storage.values.channel ?? 1;
  }

  private async setupStreaming(): Promise<void> {
    this.relayLogger = this.createRelayLogger();
    // Amcrest talkback is delivered over a separate HTTP POST to audio.cgi (see
    // handleTalkbackRtp/openTalkbackPost below), not the RTSP upstream's own ONVIF
    // backchannel, so the source is opened without requesting one.
    const source = new AvSource(this.client.rtspUrl(this.channel, 0), {
      transport: 'tcp',
      reconnect: true,
      logger: this.relayLogger,
    });
    this.relay = new Relay({
      source,
      idleTimeout: 30_000,
      stallTimeout: 8_000,
      logger: this.relayLogger,
    });
    this.relay.on('stop', () => this.resetTalkback());
    this.rtspServer = await this.relay.serveRtsp({ path: 'live', backchannel: { ...BACKCHANNEL_ADVERTISE }, sdpTimeout: 30000 });
    this.rtspServer.on('backchannel', (rtp: Buffer) => this.handleTalkbackRtp(rtp));
    this.log.log('Amcrest RTSP relay started');
  }

  private handleTalkbackRtp(rtp: Buffer): void {
    const target = selectTalkbackTarget(this.capabilities.deviceType);
    if (!this.transcoder) {
      this.talkbackBody = new PassThrough();
      this.openTalkbackPost(target.contentType, this.talkbackBody);
      this.transcoder = new BackchannelTranscoder({
        from: { ...BACKCHANNEL_ADVERTISE },
        to: { codec: target.codec, sampleRate: target.sampleRate, channels: 1, format: target.codec === 'aac' ? 'adts' : 'alaw', bitRate: 32000 },
        output: (chunk: Buffer) => this.talkbackBody?.write(chunk),
        logger: this.relayLogger,
      });
      this.transcoderStarting = this.transcoder.start();
    }
    this.transcoderStarting
      ?.then(() => this.transcoder?.push(rtp))
      .catch((e) => {
        this.log.error('Talkback transcode failed:', e);
        // Reset so the next RTP packet re-initializes a fresh transcoder/POST instead
        // of getting stuck behind the `if (!this.transcoder)` guard forever.
        this.resetTalkback();
      });
  }

  private openTalkbackPost(contentType: string, body: PassThrough): void {
    const url = this.client.urlFor(`/cgi-bin/audio.cgi?action=postAudio&httptype=singlepart&channel=${this.channel}`);
    void digestFetch({
      url,
      username: this.storage.values.username,
      password: this.storage.values.password,
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: body as unknown as BodyInit,
    }).catch((e) => this.log.error('Talkback POST failed:', e));
  }

  private resetTalkback(): void {
    // Fire-and-forget: close() failures must not become unhandled rejections.
    void this.transcoder?.close().catch(() => {});
    this.transcoder = undefined;
    this.transcoderStarting = undefined;
    this.talkbackBody?.end();
    this.talkbackBody = undefined;
  }

  private async detectCapabilities(): Promise<AmcrestCapabilities> {
    const caps: AmcrestCapabilities = { deviceType: undefined, doorbell: false, ptz: false, ptzPan: false, ptzTilt: false, ptzZoom: false };
    try {
      const info = await this.client.getSystemInfo();
      caps.deviceType = info.deviceType;
      caps.doorbell = classifyDevice(info.deviceType).isDoorbell;
    } catch (error) {
      this.log.debug('Capability detection (system info) failed:', error);
    }
    try {
      const probe = await fetchPtzCaps(this.client, this.channel);
      caps.ptz = probe.ptz;
      caps.ptzPan = probe.pan;
      caps.ptzTilt = probe.tilt;
      caps.ptzZoom = probe.zoom;
    } catch (error) {
      this.log.debug('PTZ capability probe failed:', error);
    }
    return caps;
  }

  private async setupSensors(): Promise<void> {
    this.motion = new AmcrestMotionSensor();
    await this.cameraDevice.addSensor(this.motion);

    this.object = new AmcrestObjectSensor();
    await this.cameraDevice.addSensor(this.object);

    this.audio = new AmcrestAudioSensor();
    await this.cameraDevice.addSensor(this.audio);

    if (this.capabilities.doorbell) {
      this.doorbell = new AmcrestDoorbellTrigger();
      await this.cameraDevice.addSensor(this.doorbell);
    }

    if (this.capabilities.ptz) {
      this.ptz = new AmcrestPTZSensor(this.client, this.channel);
      this.ptz.setCapabilities(this.capabilities.ptzPan, this.capabilities.ptzTilt, this.capabilities.ptzZoom);
      await this.cameraDevice.addSensor(this.ptz);
    }
  }

  private startEventLoop(): void {
    if (this.stopped) return;
    this.eventAbort = new AbortController();
    void this.runEventLoop(this.eventAbort.signal);
  }

  private async runEventLoop(signal: AbortSignal): Promise<void> {
    try {
      const stream = await this.client.attachEvents(signal);
      this.eventReconnectStreak = 0;
      this.log.log('Amcrest event stream connected');
      const decoder = new TextDecoder();
      let buffer = '';
      // Amcrest streams a multipart body; we scan the running buffer for complete boundary blocks.
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const boundary = this.detectBoundary(buffer);
        if (!boundary) continue;
        const { blobs, rest } = extractCompleteEvents(buffer, boundary);
        for (const blob of blobs) this.dispatchEvent(blob);
        buffer = rest;
        if (buffer.length > 1_000_000) buffer = '';
      }
    } catch (error) {
      if (signal.aborted || this.stopped) return;
      this.log.debug('Amcrest event stream error:', error);
    }
    if (signal.aborted || this.stopped) return;
    this.eventReconnectStreak++;
    const delay = Math.min(EVENT_RECONNECT_BASE_MS * 2 ** (this.eventReconnectStreak - 1), EVENT_RECONNECT_MAX_MS);
    this.log.debug(`Reconnecting Amcrest event stream in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startEventLoop();
    }, delay);
  }

  private detectBoundary(buffer: string): string | undefined {
    const m = /--([A-Za-z0-9'()+_,\-./:=? ]+)\r?\n/.exec(buffer);
    return m ? m[1].trim().replace(/^-+/, '') : undefined;
  }

  private dispatchEvent(blob: string): void {
    const ev = parseAmcrestEvent(blob);
    if (!ev) return;
    const c = classifyAmcrestEvent(ev);
    if (!c) return;
    switch (c.kind) {
      case 'motion':
        this.motion?.reportDetections(c.active);
        break;
      case 'audio':
        this.audio?.report(c.active);
        break;
      case 'object':
        this.object?.report(c.category, c.active);
        break;
      case 'doorbell':
        this.doorbell?.trigger();
        break;
    }
  }

  private createRelayLogger(): Logger {
    return {
      log: (...a: unknown[]) => this.log.log(...a),
      warn: (...a: unknown[]) => this.log.warn(...a),
      error: (...a: unknown[]) => this.log.error(...a),
      debug: (...a: unknown[]) => this.log.debug(...a),
    };
  }

  private createStorage(): DeviceStorage<AmcrestCameraStorage> {
    return this.cameraDevice.createStorage<AmcrestCameraStorage>([
      { type: 'string', key: 'ip', title: 'IP Address', description: 'Camera IP address, e.g. 192.168.1.50', store: true, required: true },
      { type: 'string', key: 'username', title: 'Username', description: 'Amcrest account username.', store: true, required: true },
      { type: 'string', format: 'password', key: 'password', title: 'Password', description: 'Amcrest account password.', store: true, required: true },
      { type: 'number', key: 'port', title: 'RTSP Port', description: 'RTSP port (default 554).', store: true, required: false, defaultValue: 554 },
      { type: 'number', key: 'httpPort', title: 'HTTP Port', description: 'HTTP/CGI port (default 80).', store: true, required: false, defaultValue: 80 },
      { type: 'number', key: 'channel', title: 'Channel', description: 'Camera channel (default 1).', store: true, required: false, defaultValue: 1 },
    ]);
  }
}

async function fetchPtzCaps(client: AmcrestClient, channel: number): Promise<{ ptz: boolean; pan: boolean; tilt: boolean; zoom: boolean }> {
  // Routed through the authenticated client (digest auth) — a raw, unauthenticated
  // fetch here always gets a 401 from real devices and PTZ never gets detected.
  const text = await client.getPtzCaps(channel).catch(() => '');
  const hasPanTilt = /Left|Right|Up|Down/i.test(text);
  const hasZoom = /Zoom/i.test(text);
  const ptz = hasPanTilt || hasZoom;
  return { ptz, pan: hasPanTilt, tilt: hasPanTilt, zoom: hasZoom };
}
