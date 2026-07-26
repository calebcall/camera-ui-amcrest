import type { AmcrestEvent } from './events.js';
import type { BoundingBox } from '@camera.ui/sdk';

/**
 * Dahua/Amcrest smart events express coordinates in a fixed 0-8191 space that
 * is independent of the stream resolution, so boxes can be normalized without
 * knowing the encoder settings.
 */
const AMCREST_COORD_MAX = 8191;

/** A single-frame detection lifted out of a smart-event payload. */
export interface AmcrestDetection {
  /** Bounding box normalized to 0-1 for camera.ui. */
  box: BoundingBox;
  /** Camera-side track ID (`Object.ObjectID`), stable for the life of the event. */
  trackId?: number;
}

export type AmcrestClassification =
  | { kind: 'motion'; active: boolean }
  | { kind: 'audio'; active: boolean }
  | {
    kind: 'object';
    category: 'person' | 'vehicle';
    active: boolean;
    detection?: AmcrestDetection;
  }
  | { kind: 'doorbell' };

interface AmcrestObjectPayload {
  ObjectType?: string;
  ObjectID?: number;
  BoundingBox?: number[];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function objectTypeToCategory(
  objectType?: string,
): 'person' | 'vehicle' | undefined {
  if (objectType === 'Human') return 'person';
  if (objectType === 'Vehicle') return 'vehicle';
  return undefined;
}

function eventObject(ev: AmcrestEvent): AmcrestObjectPayload | undefined {
  return (ev.data as { Object?: AmcrestObjectPayload } | undefined)?.Object;
}

/**
 * Converts an Amcrest `[x1, y1, x2, y2]` box into a normalized camera.ui box.
 * Returns undefined when the payload has no usable box (plain `VideoMotion`
 * and `SmartMotion*` events carry no coordinates at all).
 */
function toDetection(obj?: AmcrestObjectPayload): AmcrestDetection | undefined {
  const raw = obj?.BoundingBox;
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  if (raw.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    return undefined;

  const [x1, y1, x2, y2] = raw;
  const x = clamp01(x1 / AMCREST_COORD_MAX);
  const y = clamp01(y1 / AMCREST_COORD_MAX);

  return {
    box: {
      x,
      y,
      width: clamp01(x2 / AMCREST_COORD_MAX) - x,
      height: clamp01(y2 / AMCREST_COORD_MAX) - y,
    },
    trackId: typeof obj?.ObjectID === 'number' ? obj.ObjectID : undefined,
  };
}

function objectResult(
  category: 'person' | 'vehicle',
  active: boolean,
  obj?: AmcrestObjectPayload,
): AmcrestClassification {
  const detection = toDetection(obj);
  return detection
    ? { kind: 'object', category, active, detection }
    : { kind: 'object', category, active };
}

export function classifyAmcrestEvent(
  ev: AmcrestEvent,
): AmcrestClassification | undefined {
  const active = ev.action === 'Start';

  switch (ev.code) {
    case 'VideoMotion':
      return { kind: 'motion', active };
    case 'AudioMutation':
      return { kind: 'audio', active };
    case 'SmartMotionHuman':
      return { kind: 'object', category: 'person', active };
    case 'Vehicle':
      return { kind: 'object', category: 'vehicle', active };
    case 'FaceDetection':
      return objectResult('person', active, eventObject(ev));
    case 'CrossLineDetection':
    case 'CrossRegionDetection': {
      const obj = eventObject(ev);
      const category = objectTypeToCategory(obj?.ObjectType);
      if (!category) return undefined;
      return objectResult(category, active, obj);
    }
    case '_DoTalkAction_':
      return ev.action === 'Invite' ? { kind: 'doorbell' } : undefined;
    case 'CallNoAnswered':
      // Dahua doorbell (best-effort, untested)
      return { kind: 'doorbell' };
    default:
      return undefined;
  }
}
