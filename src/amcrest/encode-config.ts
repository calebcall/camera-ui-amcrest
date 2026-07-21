import { parseKeyValueBody } from './system-info.js';

export interface AmcrestStream {
  role: 'main' | 'sub';
  subtype: number;
  codec?: string;
  width?: number;
  height?: number;
}

function fromAmcrestVideoCodec(codec?: string): string | undefined {
  const c = codec?.trim();
  if (c === 'H.264') return 'h264';
  if (c === 'H.265') return 'h265';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must collapse to undefined, not be treated as a defined value
  return c || undefined;
}

export function parseEncodeConfig(
  text: string,
  channel: number,
): AmcrestStream[] {
  const kv = parseKeyValueBody(text);
  const ch = channel - 1;
  const prefix = `table.Encode[${ch}]`;
  const streams: AmcrestStream[] = [];

  const formats: { role: 'main' | 'sub'; subtype: number; key: string }[] = [
    { role: 'main', subtype: 0, key: `${prefix}.MainFormat[0]` },
    { role: 'sub', subtype: 1, key: `${prefix}.ExtraFormat[0]` },
  ];

  for (const fmt of formats) {
    const compression = kv[`${fmt.key}.Video.Compression`];
    if (compression === undefined) continue;
    if (kv[`${fmt.key}.VideoEnable`] === 'false') continue;

    const width = kv[`${fmt.key}.Video.Width`];
    const height = kv[`${fmt.key}.Video.Height`];
    streams.push({
      role: fmt.role,
      subtype: fmt.subtype,
      codec: fromAmcrestVideoCodec(compression),
      width: width ? parseInt(width, 10) : undefined,
      height: height ? parseInt(height, 10) : undefined,
    });
  }

  return streams;
}
