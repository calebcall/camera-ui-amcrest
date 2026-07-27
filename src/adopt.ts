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
  info: {
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
  };
  streams: AmcrestStream[];
}

export function buildCameraConfig(input: BuildCameraConfigInput): CameraConfig {
  // One source per stream the camera actually serves, ordered high to low as
  // parseEncodeConfig ranked them.
  const sources: CameraConfig['sources'] = input.streams.map(
    (stream, index) => ({
      name: stream.subtype === 0 ? 'main' : `extra${stream.subtype}`,
      role: stream.role,
      urls: [
        buildRtspUrl({
          ip: input.ip,
          username: input.username,
          password: input.password,
          port: input.port,
          channel: input.channel,
          subtype: stream.subtype,
        }),
      ],
      // Snapshots are served by the plugin's SnapshotInterface (snapshot.cgi, a
      // lightweight HTTP JPEG with digest auth). Do NOT mark an RTSP source for
      // snapshots — that makes camera.ui grab frames via ffmpeg over RTSP, which
      // competes with live view for the camera's limited connections and fails
      // under load (ffmpeg "exit status 69/183").
      useForSnapshot: false,
      // Only the primary stream is worth holding open; the lower-resolution
      // ones are pulled on demand by detectors and playback.
      hotMode: index === 0,
      preload: index === 0,
    }),
  );

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
