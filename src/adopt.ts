import { buildRtspUrl } from './amcrest/rtsp-url.js';

import type { AmcrestStream } from './amcrest/encode-config.js';
import type { CameraConfig } from '@camera.ui/sdk';

export interface BuildCameraConfigInput {
  name: string;
  nativeId: string;
  ip: string;
  username: string;
  password: string;
  port: number;
  channel: number;
  info: { manufacturer?: string; model?: string; serialNumber?: string; firmwareVersion?: string };
  streams: AmcrestStream[];
}

export function buildCameraConfig(input: BuildCameraConfigInput): CameraConfig {
  const main = input.streams.find((s) => s.role === 'main') ?? input.streams[0];
  const sub = input.streams.find((s) => s.role === 'sub');

  const sources: CameraConfig['sources'] = [];
  if (main) {
    sources.push({
      name: 'main',
      role: 'high-resolution',
      urls: [buildRtspUrl({ ip: input.ip, username: input.username, password: input.password, port: input.port, channel: input.channel, subtype: main.subtype })],
      // Snapshots are served by the plugin's SnapshotInterface (snapshot.cgi, a
      // lightweight HTTP JPEG with digest auth). Do NOT mark an RTSP source for
      // snapshots — that makes camera.ui grab frames via ffmpeg over RTSP, which
      // competes with live view for the camera's limited connections and fails
      // under load (ffmpeg "exit status 69/183").
      useForSnapshot: false,
      hotMode: true,
      preload: true,
    });
  }
  if (sub) {
    sources.push({
      name: 'sub',
      role: 'low-resolution',
      urls: [buildRtspUrl({ ip: input.ip, username: input.username, password: input.password, port: input.port, channel: input.channel, subtype: sub.subtype })],
      useForSnapshot: false,
      hotMode: false,
      preload: false,
    });
  }

  return {
    name: input.name,
    nativeId: input.nativeId,
    info: {
      manufacturer: input.info.manufacturer,
      model: input.info.model,
      serialNumber: input.info.serialNumber,
      firmwareVersion: input.info.firmwareVersion,
    },
    sources,
  };
}
