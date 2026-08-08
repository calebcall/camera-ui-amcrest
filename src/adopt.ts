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

/**
 * The name adoption gives the stream at `subtype`.
 *
 * Paired with subtypeFromSourceName so the two cannot drift: the name is the
 * only record of which stream a source came from that survives into camera.ui,
 * and getStreamUrl reads it back to answer per-source URL requests.
 */
export function sourceNameForSubtype(subtype: number): string {
  return subtype === 0 ? 'main' : `extra${subtype}`;
}

/**
 * The subtype a source name was minted from, or undefined if this plugin never
 * minted it — a user is free to rename a source in camera.ui, and guessing a
 * subtype from an arbitrary name would silently serve the wrong stream.
 */
export function subtypeFromSourceName(name: string): number | undefined {
  if (name === 'main') return 0;
  const match = /^extra(\d+)$/.exec(name);
  return match ? Number(match[1]) : undefined;
}

export function buildCameraConfig(input: BuildCameraConfigInput): CameraConfig {
  // One source per stream the camera actually serves, ordered high to low as
  // parseEncodeConfig ranked them.
  const sources: CameraConfig['sources'] = input.streams.map(
    (stream, index) => ({
      name: sourceNameForSubtype(stream.subtype),
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
