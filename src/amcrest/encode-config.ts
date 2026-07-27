import { parseKeyValueBody } from './system-info.js';

import type { StreamingRole } from '@camera.ui/sdk';

export interface AmcrestStream {
  role: StreamingRole;
  subtype: number;
  codec?: string;
  width?: number;
  height?: number;
}

/**
 * camera.ui has exactly three streaming roles, so at most three streams can be
 * registered even if the camera serves more.
 */
const ROLES_BY_SIZE: StreamingRole[] = [
  'high-resolution',
  'mid-resolution',
  'low-resolution',
];

/** Dahua serves ExtraFormat[i] as RTSP subtype i+1; there are three slots. */
const EXTRA_FORMAT_SLOTS = 3;

function fromAmcrestVideoCodec(codec?: string): string | undefined {
  const c = codec?.trim();
  if (c === 'H.264') return 'h264';
  if (c === 'H.265') return 'h265';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must collapse to undefined, not be treated as a defined value
  return c || undefined;
}

function pixels(s: { width?: number; height?: number }): number {
  return (s.width ?? 0) * (s.height ?? 0);
}

/** Streams the camera serves, plus any that had to be dropped for lack of a role. */
export interface AmcrestStreamSet {
  streams: AmcrestStream[];
  /** Enabled streams beyond the three camera.ui can represent, smallest first. */
  dropped: Omit<AmcrestStream, 'role'>[];
}

export function parseEncodeConfig(
  text: string,
  channel: number,
): AmcrestStreamSet {
  const kv = parseKeyValueBody(text);
  const prefix = `table.Encode[${channel - 1}]`;

  // Only MainFormat[0] is read: MainFormat[1..3] are per-trigger encoder
  // profiles (general / motion / alarm) for the *same* subtype=0 stream, so
  // enumerating them would register the same video several times over.
  const keys: { subtype: number; key: string }[] = [
    { subtype: 0, key: `${prefix}.MainFormat[0]` },
  ];
  for (let i = 0; i < EXTRA_FORMAT_SLOTS; i++) {
    keys.push({ subtype: i + 1, key: `${prefix}.ExtraFormat[${i}]` });
  }

  const found: Omit<AmcrestStream, 'role'>[] = [];
  for (const { subtype, key } of keys) {
    const compression = kv[`${key}.Video.Compression`];
    if (compression === undefined) continue;
    if (kv[`${key}.VideoEnable`] === 'false') continue;

    const width = kv[`${key}.Video.Width`];
    const height = kv[`${key}.Video.Height`];
    found.push({
      subtype,
      codec: fromAmcrestVideoCodec(compression),
      width: width ? parseInt(width, 10) : undefined,
      height: height ? parseInt(height, 10) : undefined,
    });
  }

  // Roles follow resolution rather than config order, so a camera whose extra
  // streams are configured out of order still gets sensible labels. Anything
  // past the third-largest is dropped — there is no role left for it.
  const bySize = found.sort((a, b) => pixels(b) - pixels(a));
  const ranked = bySize.slice(0, ROLES_BY_SIZE.length);

  // Largest is always high and smallest always low, so two streams read as
  // high/low rather than high/mid. Only a third stream takes the middle role.
  const streams: AmcrestStream[] = ranked.map((s, i) => ({
    role:
      i === 0
        ? 'high-resolution'
        : i === ranked.length - 1
          ? 'low-resolution'
          : 'mid-resolution',
    ...s,
  }));

  return { streams, dropped: bySize.slice(ROLES_BY_SIZE.length) };
}
