export interface PtzCaps {
  ptz: boolean;
  pan: boolean;
  tilt: boolean;
  zoom: boolean;
}

/**
 * Reads PTZ support from a `ptz.cgi?action=getCurrentProtocolCaps` reply.
 *
 * The reply is `caps.Key=value` lines. Axis support comes from `caps.Pan`,
 * `caps.Tile` (Dahua's spelling; `caps.Tilt` is accepted too) and `caps.Zoom`,
 * and the value matters: a camera without zoom still lists `caps.Zoom=false`.
 * Replies with none of those keys fall back to looking for direction words.
 */
export function parsePtzCaps(text: string): PtzCaps {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^caps\./i, '').toLowerCase();
    values.set(key, line.slice(eq + 1).trim().toLowerCase());
  }

  const axisKeys = ['pan', 'tile', 'tilt', 'zoom'];
  if (axisKeys.some((k) => values.has(k))) {
    const pan = values.get('pan') === 'true';
    const tilt = values.get('tile') === 'true' || values.get('tilt') === 'true';
    const zoom = values.get('zoom') === 'true';
    return { ptz: pan || tilt || zoom, pan, tilt, zoom };
  }

  const panTilt = /\b(Left|Right|Up|Down)\b/i.test(text);
  const zoom = /\bZoom(Tele|Wide)?\b/i.test(text);
  return { ptz: panTilt || zoom, pan: panTilt, tilt: panTilt, zoom };
}
