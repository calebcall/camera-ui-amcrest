export interface RtspUrlOptions {
  ip: string;
  username: string;
  password: string;
  port?: number;
  channel?: number;
  subtype: number;
}

export function buildRtspUrl(opts: RtspUrlOptions): string {
  const port = opts.port ?? 554;
  const channel = opts.channel ?? 1;
  const user = encodeURIComponent(opts.username);
  const pass = encodeURIComponent(opts.password);
  return `rtsp://${user}:${pass}@${opts.ip}:${port}/cam/realmonitor?channel=${channel}&subtype=${opts.subtype}`;
}
