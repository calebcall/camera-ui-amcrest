import { PassThrough } from 'node:stream';

import { AvSource, BackchannelTranscoder, Relay } from '@seydx/rtsp';

import { subtypeFromSourceName } from './adopt.js';
import { AmcrestClient, AmcrestSnapshotError } from './amcrest/api.js';
import { classifyAmcrestEvent } from './amcrest/classify.js';
import { classifyDevice } from './amcrest/device.js';
import { digestFetch } from './amcrest/digest-auth.js';
import {
  detectBoundary,
  extractCompleteEvents,
} from './amcrest/event-reader.js';
import { parseAmcrestEvent } from './amcrest/events.js';
import {
  describeTalkbackRejection,
  selectTalkbackTarget,
} from './amcrest/talkback.js';
import { UnhandledCodeTracker } from './amcrest/unhandled-codes.js';
import {
  AmcrestAudioSensor,
  AmcrestDoorbellTrigger,
  AmcrestMotionSensor,
  AmcrestObjectSensor,
  AmcrestProblemSensor,
  AmcrestPTZSensor,
  AmcrestTamperSensor,
} from './sensors/index.js';
import {
  compileZones,
  decideObjectEvent,
  describeBox,
  findKeptDetection,
  hasUsableCoordinates,
} from './zones/filter.js';

import type {
  AmcrestClassification,
  AmcrestDetection,
} from './amcrest/classify.js';
import type { TalkbackTarget } from './amcrest/talkback.js';
import type {
  AmcrestCapabilities,
  AmcrestCameraStorage,
  AmcrestInitialSettings,
} from './types.js';
import type { CompiledZone } from './zones/filter.js';
import type {
  CameraDevice,
  DetectionLabel,
  CameraZones,
  DeviceStorage,
  Disposable,
  LoggerService,
  SnapshotInterface,
  StreamingInterface,
} from '@camera.ui/sdk';
import type { Logger, RtspServerSink } from '@seydx/rtsp';

// Advertised to RTSP viewers as the backchannel codec and, reused verbatim, as the
// BackchannelTranscoder's inbound ("from") format — the shapes are identical.
const BACKCHANNEL_ADVERTISE = {
  codec: 'pcm_alaw',
  payloadType: 8,
  clockRate: 8000,
  channels: 1,
} as const;
const ISSUES_URL = 'https://github.com/calebcall/camera-ui-amcrest/issues';
const EVENT_RECONNECT_BASE_MS = 2000;
const EVENT_RECONNECT_MAX_MS = 30000;
/** How long to leave talkback alone after the camera refused a session. */
const TALKBACK_COOLDOWN_MS = 30000;

class Implementations implements StreamingInterface, SnapshotInterface {
  constructor(private readonly cam: AmcrestCamera) {}
  async streamUrl(sourceId: string): Promise<string> {
    return this.cam.getStreamUrl(sourceId);
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
  /** Epoch ms before which no new talkback session is opened; see blockTalkback. */
  private talkbackBlockedUntil = 0;

  private motion?: AmcrestMotionSensor;
  private object?: AmcrestObjectSensor;
  private audio?: AmcrestAudioSensor;
  private doorbell?: AmcrestDoorbellTrigger;
  private ptz?: AmcrestPTZSensor;
  private tamper?: AmcrestTamperSensor;
  private problem?: AmcrestProblemSensor;

  private zones: CompiledZone[] = [];
  private zonesSub?: Disposable;
  /** `${code}:${category}` pairs already warned about; see warnBoxless. */
  private readonly boxlessWarned = new Set<string>();
  /**
   * Categories whose activation the zones suppressed, keyed to the reason,
   * awaiting a Stop that might show the object moved into a zone after all.
   * Bounded at two entries (person, vehicle). See reviewSuppressedStart.
   *
   * Keyed by category, not by track, so the pairing is best-effort: two
   * overlapping tracks of the same category will pair the first Stop with the
   * second track's reason. That matches the rest of the pipeline — the object
   * sensor is category-keyed too — and this is observation only, so a wider
   * mechanism is not worth the divergence. `AmcrestDetection.trackId` is
   * available if the logged data ever shows the mispairing matters.
   */
  private readonly suppressedStarts = new Map<DetectionLabel, string>();

  /**
   * The last snapshot failure already reported at error level; see
   * reportSnapshotFailure. Cleared by the next successful snapshot, so a camera
   * that recovers and fails again says so again.
   */
  private snapshotFailure?: string;

  private eventAbort?: AbortController;
  private eventReconnectStreak = 0;
  private readonly unhandledCodes = new UnhandledCodeTracker();
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
      if (initialSettings.channel !== undefined)
        this.storage.values.channel = initialSettings.channel;
      if (initialSettings.port !== undefined)
        this.storage.values.port = initialSettings.port;
      if (initialSettings.httpPort !== undefined)
        this.storage.values.httpPort = initialSettings.httpPort;
      await this.storage.save();
    }

    const v = this.storage.values;
    if (!v.ip || !v.username || !v.password) {
      this.cameraDevice.logger.attention(
        'Please configure the Amcrest connection settings',
      );
      return;
    }

    // Built here, after settings are confirmed present (and persisted, if this is a
    // fresh adoption) — never in the constructor, where storage.values would still be
    // empty on a brand-new adoption.
    this.client = new AmcrestClient({
      ip: v.ip,
      username: v.username,
      password: v.password,
      port: v.port,
      httpPort: v.httpPort,
    });

    this.capabilities = await this.detectCapabilities();
    await this.setupStreaming();
    await this.cameraDevice.implement(new Implementations(this));
    await this.setupSensors();
    this.zones = compileZones(this.cameraDevice.zones);
    this.zonesSub = this.cameraDevice
      .onPropertyChange('zones')
      .subscribe(({ newData }) => this.applyDetectionZones(newData));
    this.startEventLoop();
    this.cameraDevice.connect();
  }

  async getStreamUrl(sourceId?: string): Promise<string> {
    // Only reachable once implement() has registered Implementations, which happens
    // after this.client is built in initialize() — but guard anyway in case the SDK
    // calls in from an unexpected path.
    if (!this.client) {
      throw new Error('Amcrest camera is not configured');
    }
    // Every source the plugin registers is a distinct stream on the camera, so a
    // request for the low-resolution one has to resolve to that stream — the relay
    // only carries the main one, and answering with it made detectors and playback
    // decode full-resolution video no matter which source they asked for.
    const subtype = this.subtypeForSource(sourceId);
    if (subtype !== undefined && subtype !== 0) {
      return this.client.rtspUrl(this.channel, subtype);
    }
    // The main stream keeps going through the relay: it is the only path that
    // advertises the RTSP backchannel talkback rides on. An unrecognised source
    // lands here too, which is the pre-1.7.0 behaviour for every source.
    if (this.rtspServer) return `${this.rtspServer.url}#timeout=30`;
    // Fallback: direct RTSP (no backchannel) if relay unavailable.
    return this.client.rtspUrl(this.channel, 0);
  }

  /**
   * The stream subtype behind one of camera.ui's source ids, or undefined when
   * the id names nothing this plugin registered — the server mints the ids, so
   * the source's name is the only link back to the stream it came from.
   */
  private subtypeForSource(sourceId: string | undefined): number | undefined {
    if (!sourceId) return undefined;
    const source = this.cameraDevice.sources?.find((s) => s._id === sourceId);
    if (!source) return undefined;
    return subtypeFromSourceName(source.name);
  }

  /**
   * A JPEG still, or undefined when the camera would not give one.
   *
   * Returning undefined is load-bearing rather than merely tidy: camera.ui asks
   * this plugin before it asks go2rtc, and it takes any non-empty answer, caches
   * it and stops looking. Handing back a body the camera refused would suppress
   * the fallback that could have produced a picture.
   */
  async getSnapshot(): Promise<ArrayBuffer | undefined> {
    if (!this.client) return undefined;
    try {
      const buf = await this.client.snapshot(this.channel);
      this.snapshotFailure = undefined;
      return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    } catch (error) {
      this.reportSnapshotFailure(error);
      return undefined;
    }
  }

  /**
   * Says a snapshot failed, loudly the first time and quietly while it stays
   * the same.
   *
   * Snapshots are taken on a timer and again on every event, so a camera that
   * has stopped serving them would fill the log with one identical line a
   * minute. The first occurrence is the one that has to be visible; a change in
   * the message means something else is wrong and earns another.
   */
  private reportSnapshotFailure(error: unknown): void {
    const message =
      error instanceof AmcrestSnapshotError
        ? error.message
        : `Snapshot failed: ${String(error)}`;
    if (message === this.snapshotFailure) {
      this.log.debug(message);
      return;
    }
    this.snapshotFailure = message;
    this.log.error(message);
  }

  destroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.eventAbort?.abort();
    this.zonesSub?.dispose();
    this.zonesSub = undefined;
    this.suppressedStarts.clear();
    this.object?.destroy();
    this.tamper?.destroy();
    this.problem?.destroy();
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
    this.rtspServer = await this.relay.serveRtsp({
      path: 'live',
      backchannel: { ...BACKCHANNEL_ADVERTISE },
      sdpTimeout: 30000,
    });
    this.rtspServer.on('backchannel', (rtp: Buffer) =>
      this.handleTalkbackRtp(rtp),
    );
    this.log.log('Amcrest RTSP relay started');
  }

  private handleTalkbackRtp(rtp: Buffer): void {
    // A session that just failed is not retried on the very next packet; see
    // blockTalkback.
    if (Date.now() < this.talkbackBlockedUntil) return;
    const target = selectTalkbackTarget(this.capabilities.deviceType);
    if (!this.transcoder) {
      // Once per session, not once per packet — the backchannel delivers ~50 a
      // second. This is the first sign anywhere that camera.ui sent audio at all.
      this.log.debug(
        `Talkback session opening: ${target.codec} at ${target.sampleRate}Hz, sent as ${target.contentType}`,
      );
      this.talkbackBody = new PassThrough();
      this.openTalkbackPost(target, this.talkbackBody);
      this.transcoder = new BackchannelTranscoder({
        from: { ...BACKCHANNEL_ADVERTISE },
        to: {
          codec: target.codec,
          sampleRate: target.sampleRate,
          channels: 1,
          format: target.codec === 'aac' ? 'adts' : 'alaw',
          bitRate: 32000,
        },
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

  private openTalkbackPost(target: TalkbackTarget, body: PassThrough): void {
    // No credentials in this URL — digestFetch authenticates with a header — so it
    // is safe to log.
    const url = this.client.urlFor(
      `/cgi-bin/audio.cgi?action=postAudio&httptype=singlepart&channel=${this.channel}`,
    );
    this.log.debug(`Talkback POST to ${url}`);
    void digestFetch({
      url,
      username: this.storage.values.username,
      password: this.storage.values.password,
      method: 'POST',
      headers: { 'Content-Type': target.contentType },
      body: body as unknown as BodyInit,
    })
      .then(async (res) => {
        // fetch resolves for 4xx and 5xx, so a refusal is invisible unless the
        // status is read. Not reading it is what made "two-way audio does not
        // work" produce an empty log.
        const rejection = describeTalkbackRejection(
          res.status,
          res.statusText,
          await res.text().catch(() => ''),
        );
        if (!rejection) {
          this.log.debug(`Talkback session ended cleanly (HTTP ${res.status})`);
          return;
        }
        this.log.error(rejection);
        this.blockTalkback();
      })
      .catch((e) => {
        this.log.error('Talkback POST failed:', e);
        this.blockTalkback();
      });
  }

  /**
   * Tears down a session the camera refused and declines to start another for a
   * short while. Without the pause the next RTP packet would open a fresh POST
   * against a device that just said no — around fifty times a second.
   */
  private blockTalkback(): void {
    this.talkbackBlockedUntil = Date.now() + TALKBACK_COOLDOWN_MS;
    this.resetTalkback();
    this.log.debug(
      `Talkback paused for ${TALKBACK_COOLDOWN_MS / 1000}s after the failed session`,
    );
  }

  private resetTalkback(): void {
    if (this.transcoder || this.talkbackBody) {
      this.log.debug('Talkback session closing');
    }
    // Fire-and-forget: close() failures must not become unhandled rejections.
    void this.transcoder?.close().catch(() => {});
    this.transcoder = undefined;
    this.transcoderStarting = undefined;
    this.talkbackBody?.end();
    this.talkbackBody = undefined;
  }

  private async detectCapabilities(): Promise<AmcrestCapabilities> {
    const caps: AmcrestCapabilities = {
      deviceType: undefined,
      doorbell: false,
      ptz: false,
      ptzPan: false,
      ptzTilt: false,
      ptzZoom: false,
    };
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

    // Registered unconditionally: whether a camera emits these codes cannot be
    // probed, only observed, and a sensor that stays false is a truthful answer
    // for a device that never reports interference or a fault.
    this.tamper = new AmcrestTamperSensor();
    await this.cameraDevice.addSensor(this.tamper);

    this.problem = new AmcrestProblemSensor();
    await this.cameraDevice.addSensor(this.problem);

    if (this.capabilities.doorbell) {
      this.doorbell = new AmcrestDoorbellTrigger();
      await this.cameraDevice.addSensor(this.doorbell);
    }

    if (this.capabilities.ptz) {
      this.ptz = new AmcrestPTZSensor(this.client, this.channel);
      this.ptz.setCapabilities(
        this.capabilities.ptzPan,
        this.capabilities.ptzTilt,
        this.capabilities.ptzZoom,
      );
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
        const boundary = detectBoundary(buffer);
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
    // Track continuity ends with the stream, so a pending suppression must not
    // be paired with an unrelated Stop after we reconnect.
    this.suppressedStarts.clear();
    this.eventReconnectStreak++;
    const delay = Math.min(
      EVENT_RECONNECT_BASE_MS * 2 ** (this.eventReconnectStreak - 1),
      EVENT_RECONNECT_MAX_MS,
    );
    this.log.debug(`Reconnecting Amcrest event stream in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startEventLoop();
    }, delay);
  }

  private dispatchEvent(blob: string): void {
    const ev = parseAmcrestEvent(blob);
    if (!ev) return;
    const c = classifyAmcrestEvent(ev);
    if (!c) {
      // Log each unknown code once so event gaps are visible instead of silent.
      if (this.unhandledCodes.shouldReport(ev.code)) {
        this.log.debug(
          `Unhandled Amcrest event code: ${ev.code} (action=${ev.action}) — please report it at ${ISSUES_URL}`,
        );
      }
      return;
    }
    switch (c.kind) {
      case 'motion':
        this.motion?.reportDetections(c.active);
        break;
      case 'audio':
        this.audio?.report(c.active);
        break;
      case 'object': {
        const decision = decideObjectEvent(c, this.zones);
        if (decision.kind === 'suppress') {
          const reason = decision.reasons.join('; ');
          this.log.debug(`${ev.code} suppressed by detection zones: ${reason}`);
          // A Pulse never gets a matching Stop, so there would be nothing to
          // reconsider this against and the entry would never clear.
          if (!c.momentary) this.suppressedStarts.set(c.category, reason);
          break;
        }
        // Any later activation of this category alerts, so an earlier pending
        // suppression can no longer be reported as "no alert was sent". Guarded
        // on `active` because the deactivation path owns the entry and clears it
        // itself; boxless activations are `active` too and are equally stale.
        if (c.active) this.suppressedStarts.delete(c.category);
        if (
          decision.kind === 'skipped' &&
          decision.reason === 'no-coordinates'
        ) {
          this.warnBoxless(ev.code, c.category);
        }
        if (decision.kind === 'skipped' && decision.reason === 'deactivation') {
          this.reviewSuppressedStart(ev.code, c.category, decision.detections);
        }
        if (decision.kind === 'report' && decision.dropped.length > 0) {
          this.log.debug(
            `${ev.code} partially filtered by detection zones: ${decision.dropped.join('; ')}`,
          );
        }
        if (decision.kind === 'report' && decision.dropped.length === 0) {
          this.logZonePass(ev.code, decision.detections);
        }
        if (c.momentary) {
          this.object?.pulse(c.category, decision.detections);
        } else {
          this.object?.report(c.category, c.active, decision.detections);
        }
        break;
      }
      case 'doorbell':
        this.doorbell?.trigger();
        break;
      case 'tamper':
        this.reportState(this.tamper, c, 'Tamper');
        break;
      case 'problem':
        this.reportState(this.problem, c, 'Problem');
        break;
    }
  }

  /**
   * Applies a tamper or problem event to its sensor and says so.
   *
   * These codes are classified from the Dahua CGI list rather than from a
   * capture, so the log line is the record of which ones a given camera really
   * emits — worth having the first time each code appears, and not worth
   * repeating after that.
   */
  private reportState(
    sensor: AmcrestTamperSensor | AmcrestProblemSensor | undefined,
    c: Extract<AmcrestClassification, { kind: 'tamper' | 'problem' }>,
    label: string,
  ): void {
    if (!sensor) return;
    if (c.momentary) sensor.pulse(c.code);
    else sensor.report(c.code, c.active);
    const held = sensor.activeCodes;
    this.log.debug(
      held.length > 0
        ? `${label} active: ${held.join(', ')}`
        : `${label} cleared (${c.code} ended)`,
    );
  }

  /**
   * Adopts a new zone list. Separate from the subscriber so the behaviour that
   * depends on it is testable without a live camera.
   *
   * Any pending suppression is forgotten: its recorded reason describes the
   * zones as they were, and measuring a Stop against the new ones would claim
   * the same box both failed and passed. Same rationale as the reconnect clear
   * in runEventLoop — the premise the entry rests on no longer holds.
   */
  private applyDetectionZones(zones: CameraZones | undefined): void {
    this.zones = compileZones(zones);
    this.suppressedStarts.clear();
    this.log.debug(`Detection zones updated: ${this.zones.length} zone(s)`);
  }

  /**
   * Warns once per code+category that an event arrived without coordinates, so
   * detection zones could not be applied to it. Only worth saying when the user
   * has actually drawn zones — otherwise it describes a non-problem.
   */
  private warnBoxless(code: string, category: string): void {
    if (this.zones.length === 0) return;
    const key = `${code}:${category}`;
    if (this.boxlessWarned.has(key)) return;
    this.boxlessWarned.add(key);
    this.log.debug(
      `${code} (${category}) carried no coordinates, so detection zones cannot be applied to it — it is reported unfiltered. Further occurrences are not logged.`,
    );
  }

  /**
   * Says whether an object whose activation the zones suppressed had, by the
   * time it left, moved somewhere those zones would have accepted.
   *
   * Observation only — see #26. The camera sends one Start and one Stop per
   * track with nothing in between, and the two boxes can be entirely disjoint,
   * so an object that walks into a zone after its Start produces no alert. This
   * records how often that happens, and where, without changing behaviour.
   */
  private reviewSuppressedStart(
    code: string,
    category: DetectionLabel,
    detections: AmcrestDetection[],
  ): void {
    const reason = this.suppressedStarts.get(category);
    if (reason === undefined) return;
    this.suppressedStarts.delete(category);

    // A Stop with no position cannot answer the question either way, and
    // claiming the object stayed outside would put a false statement in the log.
    // Saying so explicitly keeps the log decidable: silence here would be
    // indistinguishable from "walk-ins never happen".
    if (!hasUsableCoordinates(detections)) {
      this.log.debug(
        `${code} left without coordinates — cannot tell whether it entered the zones`,
      );
      return;
    }

    const kept = findKeptDetection(detections, category, this.zones);
    if (!kept) {
      this.log.debug(
        `${code} stayed outside the zones for the whole event — correctly suppressed`,
      );
      return;
    }
    this.log.debug(
      `${code} entered the zones during the event — no alert was sent (see #26). Stop ${describeBox(kept.box)} would pass; Start was suppressed: ${reason}`,
    );
  }

  /**
   * Confirms zone evaluation ran and every detection survived. Without this, a
   * working zone is indistinguishable in the log from no zones at all — both
   * produce a notification and silence. See #27.
   */
  private logZonePass(code: string, detections: AmcrestDetection[]): void {
    if (this.zones.length === 0) return;
    const boxes = detections.map((d) => describeBox(d.box)).join(', ');
    this.log.debug(
      `${code} passed detection zones (${this.zones.length} zone(s)): ${boxes}`,
    );
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
      {
        type: 'string',
        key: 'ip',
        title: 'IP Address',
        description: 'Camera IP address, e.g. 192.168.1.50',
        store: true,
        required: true,
      },
      {
        type: 'string',
        key: 'username',
        title: 'Username',
        description: 'Amcrest account username.',
        store: true,
        required: true,
      },
      {
        type: 'string',
        format: 'password',
        key: 'password',
        title: 'Password',
        description: 'Amcrest account password.',
        store: true,
        required: true,
      },
      {
        type: 'number',
        key: 'port',
        title: 'RTSP Port',
        description: 'RTSP port (default 554).',
        store: true,
        required: false,
        defaultValue: 554,
      },
      {
        type: 'number',
        key: 'httpPort',
        title: 'HTTP Port',
        description: 'HTTP/CGI port (default 80).',
        store: true,
        required: false,
        defaultValue: 80,
      },
      {
        type: 'number',
        key: 'channel',
        title: 'Channel',
        description: 'Camera channel (default 1).',
        store: true,
        required: false,
        defaultValue: 1,
      },
    ]);
  }
}

async function fetchPtzCaps(
  client: AmcrestClient,
  channel: number,
): Promise<{ ptz: boolean; pan: boolean; tilt: boolean; zoom: boolean }> {
  // Routed through the authenticated client (digest auth) — a raw, unauthenticated
  // fetch here always gets a 401 from real devices and PTZ never gets detected.
  const text = await client.getPtzCaps(channel).catch(() => '');
  const hasPanTilt = /Left|Right|Up|Down/i.test(text);
  const hasZoom = /Zoom/i.test(text);
  const ptz = hasPanTilt || hasZoom;
  return { ptz, pan: hasPanTilt, tilt: hasPanTilt, zoom: hasZoom };
}
