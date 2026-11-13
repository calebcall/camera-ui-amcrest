import type { PtzCommand } from './ptz-commands.js';

export interface PtzPreset {
  /** Preset number the camera addresses it by. */
  index: number;
  /** Unique display name. */
  name: string;
}

/**
 * Reads the preset list from a `ptz.cgi?action=getPresets` reply, which is
 * `presets[n].Index=…` / `presets[n].Name=…` lines.
 *
 * Presets come back in index order. Every name is unique, because camera.ui
 * addresses presets by name: an unnamed preset becomes `Preset <index>` and a
 * repeated name gets its index appended.
 */
export function parsePtzPresets(text: string): PtzPreset[] {
  const entries = new Map<string, { index?: number; name?: string }>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^presets\[(\d+)\]\.(Index|Name)=(.*)$/i.exec(line.trim());
    if (!match) continue;
    const [, slot, field, value] = match;
    const entry = entries.get(slot) ?? {};
    if (field.toLowerCase() === 'index') {
      const index = Number(value.trim());
      if (Number.isInteger(index) && index > 0) entry.index = index;
    } else {
      entry.name = value.trim();
    }
    entries.set(slot, entry);
  }

  const presets = [...entries.values()]
    .filter((e): e is { index: number; name?: string } => e.index !== undefined)
    .sort((a, b) => a.index - b.index);

  const used = new Set<string>();
  return presets.map(({ index, name }) => {
    // An empty name counts as unnamed, so `??` would not do here.
    let label = name !== undefined && name !== '' ? name : `Preset ${index}`;
    if (used.has(label)) label = `${label} (${index})`;
    used.add(label);
    return { index, name: label };
  });
}

/** The ptz.cgi command that moves the camera to preset `index`. */
export function gotoPresetCommand(index: number): PtzCommand {
  return { action: 'start', code: 'GotoPreset', arg2: index };
}
