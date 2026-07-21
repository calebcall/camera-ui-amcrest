import { API_EVENT, BasePlugin } from '@camera.ui/sdk';

import { buildCameraConfig } from './adopt.js';
import { AmcrestClient } from './amcrest/api.js';
import { discover } from './amcrest/discovery.js';
import { discoverWs } from './amcrest/wsdiscovery.js';
import { AmcrestCamera } from './camera.js';

import type { AmcrestInitialSettings, AmcrestPluginStorage } from './types.js';
import type {
  CameraConfig,
  CameraDevice,
  DeviceStorage,
  DiscoveredCamera,
  DiscoveryProvider,
  FormSubmitResponse,
  JsonSchema,
  JsonSchemaWithoutCallbacks,
  LoggerService,
  PluginAPI,
} from '@camera.ui/sdk';

const DISCOVERY_TIMEOUT_MS = 6000;
const DEFAULT_RTSP_PORT = 554;
const DEFAULT_HTTP_PORT = 80;

export default class AmcrestPlugin
  extends BasePlugin<AmcrestPluginStorage>
  implements DiscoveryProvider {
  private cameras = new Map<string, AmcrestCamera>();
  private existing = new Map<string, CameraDevice>();
  // Adoption-form fields (ip/username/password/channel/port/httpPort) resolved in
  // onAdoptCamera. The SDK only persists the CameraConfig returned from onAdoptCamera,
  // not these settings, so they're bridged here to onCameraAdded -> initCamera, which
  // hands them to AmcrestCamera.initialize() to persist into its own storage.
  private pendingSettings = new Map<string, AmcrestInitialSettings>();

  constructor(
    logger: LoggerService,
    api: PluginAPI,
    storage: DeviceStorage<AmcrestPluginStorage>,
  ) {
    super(logger, api, storage);
    this.api.on(API_EVENT.SHUTDOWN, this.stop.bind(this));
  }

  // Plugin-level settings form: lets the user register a camera by IP when Dahua
  // discovery can't reach it. Pressing "Add Camera" pushes it into the adoption
  // list, where onGetCameraSettings/onAdoptCamera complete the credentials flow.
  override get storageSchema(): JsonSchema[] {
    return [
      {
        type: 'string',
        key: 'manualHost',
        title: 'Add Camera — IP Address',
        description:
          'Enter the camera or doorbell IP (e.g. 192.168.1.50), then press "Add Camera". It will appear in the list of cameras to adopt.',
        required: false,
        store: true,
      },
      {
        type: 'string',
        key: 'manualName',
        title: 'Add Camera — Name (optional)',
        description: 'Optional display name for the manually added camera.',
        required: false,
        store: true,
      },
      {
        type: 'submit',
        key: 'addManual',
        title: 'Add Camera',
        color: 'success',
        description:
          'Register the camera at the IP above so it can be adopted.',
        onClick: async (value) => this.addManualCamera(value),
      },
    ];
  }

  private async addManualCamera(value: unknown): Promise<FormSubmitResponse> {
    // The submit handler receives the live form values. Handle both the flat
    // shape and a possible { config } wrapper.
    const raw = (value ?? {}) as Record<string, unknown>;
    const fields = (raw.config ?? raw) as {
      manualHost?: string;
      manualName?: string;
    };
    const host = (fields.manualHost ?? '').trim();
    if (!host) {
      return {
        toast: {
          type: 'warning',
          message: 'Enter an IP address before pressing "Add Camera".',
        },
      };
    }
    const id = `amcrest-${host}`;
    if (Array.from(this.existing.values()).some((c) => c.nativeId === id)) {
      return {
        toast: {
          type: 'info',
          message: `A camera for ${host} has already been added.`,
        },
      };
    }
    const name = (fields.manualName ?? '').trim() || `Amcrest (${host})`;
    try {
      await this.api.deviceManager.pushDiscoveredCameras([
        { id, name, manufacturer: 'Amcrest', address: host },
      ]);
    } catch (error) {
      this.logger.error('Failed to add manual Amcrest camera:', error);
      return {
        toast: {
          type: 'error',
          message: `Failed to add camera ${host}: ${String(error)}`,
        },
      };
    }
    this.logger.log(
      `Manual Amcrest camera added: ${name} (${host}). Adopt it from the camera list to enter credentials.`,
    );
    return {
      toast: {
        type: 'success',
        message: `${name} added — adopt it from the camera list.`,
      },
    };
  }

  async configureCameras(cameras: CameraDevice[]): Promise<void> {
    for (const camera of cameras) {
      this.existing.set(camera.id, camera);
      await this.initCamera(camera);
    }
  }

  async onCameraAdded(camera: CameraDevice): Promise<void> {
    this.existing.set(camera.id, camera);
    const initialSettings = camera.nativeId
      ? this.pendingSettings.get(camera.nativeId)
      : undefined;
    await this.initCamera(camera, initialSettings);
    if (camera.nativeId) this.pendingSettings.delete(camera.nativeId);
  }

  async onCameraReleased(cameraId: string): Promise<void> {
    this.cameras.get(cameraId)?.destroy();
    this.cameras.delete(cameraId);
    this.existing.delete(cameraId);
  }

  async onDiscoverCameras(): Promise<DiscoveredCamera[]> {
    const logger = {
      debug: (...a: unknown[]) => this.logger.debug(...a),
      log: (...a: unknown[]) => this.logger.log(...a),
    };

    // Merge two discovery mechanisms by IP: ONVIF WS-Discovery (which most
    // Amcrest units answer) and the Dahua DHIP probe (some Dahua-firmware units).
    const [ws, dahua] = await Promise.all([
      discoverWs(DISCOVERY_TIMEOUT_MS, logger).catch((e: unknown) => {
        this.logger.debug('WS-Discovery failed:', e);
        return [];
      }),
      discover(DISCOVERY_TIMEOUT_MS, logger).catch((e: unknown) => {
        this.logger.debug('Dahua discovery failed:', e);
        return [];
      }),
    ]);

    const byIp = new Map<string, { model?: string }>();
    for (const d of dahua) {
      byIp.set(d.ip, { model: d.deviceType });
    }
    for (const d of ws) {
      byIp.set(d.ip, { model: d.hardware ?? byIp.get(d.ip)?.model });
    }

    this.logger.log(
      `Amcrest discovery: ${byIp.size} device(s) found (WS-Discovery: ${ws.length}, DHIP: ${dahua.length})`,
    );

    return Array.from(byIp.entries())
      .filter(
        ([ip]) =>
          !Array.from(this.existing.values()).some(
            (c) => c.nativeId === `amcrest-${ip}`,
          ),
      )
      .map(([ip, info]) => ({
        id: `amcrest-${ip}`,
        name: info.model ? `Amcrest ${info.model}` : `Amcrest (${ip})`,
        manufacturer: 'Amcrest',
        model: info.model,
        address: ip,
      }));
  }

  async onGetCameraSettings(
    camera: DiscoveredCamera,
  ): Promise<JsonSchemaWithoutCallbacks[]> {
    return [
      {
        type: 'string',
        key: 'ip',
        title: 'IP Address',
        description: 'Camera IP address, e.g. 192.168.1.50',
        required: true,
        defaultValue: camera.address,
      },
      {
        type: 'string',
        key: 'username',
        title: 'Username',
        description: 'Amcrest account username.',
        required: true,
      },
      {
        type: 'string',
        format: 'password',
        key: 'password',
        title: 'Password',
        description: 'Amcrest account password.',
        required: true,
      },
      {
        type: 'number',
        key: 'channel',
        title: 'Channel',
        description: 'Camera channel (default 1).',
        required: false,
        defaultValue: 1,
      },
      {
        type: 'number',
        key: 'port',
        title: 'RTSP Port',
        description: 'RTSP port (default 554).',
        required: false,
        defaultValue: DEFAULT_RTSP_PORT,
      },
      {
        type: 'number',
        key: 'httpPort',
        title: 'HTTP Port',
        description: 'HTTP/CGI port (default 80).',
        required: false,
        defaultValue: DEFAULT_HTTP_PORT,
      },
    ];
  }

  async onAdoptCamera(
    camera: DiscoveredCamera,
    settings: Record<string, unknown>,
  ): Promise<CameraConfig> {
    const ip = (settings.ip as string) || camera.address;
    const username = settings.username as string;
    const password = settings.password as string;
    const channel = (settings.channel as number) || 1;
    const port = (settings.port as number) || DEFAULT_RTSP_PORT;
    const httpPort = (settings.httpPort as number) || DEFAULT_HTTP_PORT;
    if (!ip || !username || !password) {
      throw new Error('IP address, username and password are required');
    }

    const client = new AmcrestClient({
      ip,
      username,
      password,
      port,
      httpPort,
    });
    const info = await client.getSystemInfo(); // throws 'not amcrest' if wrong device
    const streams = await client.getStreams(channel);
    if (streams.length === 0) {
      throw new Error('No enabled video streams found on the device');
    }

    const name =
      camera.name ||
      (info.deviceType ? `Amcrest ${info.deviceType}` : `Amcrest (${ip})`);
    const nativeId = `amcrest-${ip}`;
    const config = buildCameraConfig({
      name,
      nativeId,
      ip,
      username,
      password,
      port,
      channel,
      info: {
        manufacturer: 'Amcrest',
        model: info.deviceType,
        serialNumber: info.serialNumber,
        firmwareVersion: info.hardwareVersion,
      },
      streams,
    });
    // Config is returned to the SDK (persisted), but ip/username/password/etc are not
    // part of it — stash them here so onCameraAdded can hand them to
    // AmcrestCamera.initialize() to persist into the camera's own storage.
    this.pendingSettings.set(nativeId, {
      ip,
      username,
      password,
      channel,
      port,
      httpPort,
    });
    this.logger.log(
      `Amcrest device adopted: ${name} (${streams.length} stream(s))`,
    );
    return config;
  }

  private async initCamera(
    camera: CameraDevice,
    initialSettings?: AmcrestInitialSettings,
  ): Promise<void> {
    const controller = new AmcrestCamera(camera);
    this.cameras.set(camera.id, controller);
    await controller.initialize(initialSettings);
  }

  private async stop(): Promise<void> {
    for (const c of this.cameras.values()) c.destroy();
    this.cameras.clear();
  }
}
