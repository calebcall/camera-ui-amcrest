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
  /** Camera-side track ID, stable for the life of the event. */
  trackId?: number;
}

export type AmcrestClassification =
  | { kind: 'motion'; active: boolean }
  | { kind: 'audio'; active: boolean }
  | {
    kind: 'object';
    category: 'person' | 'vehicle';
    active: boolean;
    detections?: AmcrestDetection[];
    // True for `action=Pulse` events, which are instantaneous and never get a
    // matching `Stop`. Consumers must clear these on a timer of their own.
    momentary?: boolean;
  }
  | { kind: 'doorbell' };

/**
 * Firmware disagrees on the payload shape. Smart events use `Object`/`Objects`
 * with `BoundingBox` and `ObjectID`; SmartMotion* uses a lowercase `object`
 * array with `Rect` and a per-type id (`VehicleID`, `HumanID`). Both express
 * the rectangle as `[x1, y1, x2, y2]` in the same 0-8191 space.
 */
interface AmcrestObjectPayload {
  ObjectType?: string;
  ObjectID?: number;
  VehicleID?: number;
  HumanID?: number;
  BoundingBox?: number[];
  Rect?: number[];
}

interface AmcrestEventData {
  Object?: AmcrestObjectPayload;
  Objects?: AmcrestObjectPayload[];
  object?: AmcrestObjectPayload[];
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

function eventData(ev: AmcrestEvent): AmcrestEventData | undefined {
  return ev.data as AmcrestEventData | undefined;
}

/**
 * Every object the payload describes, whichever shape the firmware used. The
 * arrays are preferred over the single `Object`, which duplicates the first
 * entry on the firmware that sends both.
 */
function payloadObjects(data?: AmcrestEventData): AmcrestObjectPayload[] {
  if (Array.isArray(data?.object) && data.object.length > 0) return data.object;
  if (Array.isArray(data?.Objects) && data.Objects.length > 0)
    return data.Objects;
  return data?.Object ? [data.Object] : [];
}

/**
 * Converts an Amcrest `[x1, y1, x2, y2]` rectangle into a normalized camera.ui
 * box. Returns undefined when the object carries no usable rectangle — plain
 * `VideoMotion` has none, and some firmware sends bare Start/Stop with no data.
 */
function toDetection(obj: AmcrestObjectPayload): AmcrestDetection | undefined {
  const raw = obj.BoundingBox ?? obj.Rect;
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  if (raw.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    return undefined;

  const [x1, y1, x2, y2] = raw;
  const x = clamp01(x1 / AMCREST_COORD_MAX);
  const y = clamp01(y1 / AMCREST_COORD_MAX);
  const trackId = obj.ObjectID ?? obj.VehicleID ?? obj.HumanID;

  return {
    box: {
      x,
      y,
      width: clamp01(x2 / AMCREST_COORD_MAX) - x,
      height: clamp01(y2 / AMCREST_COORD_MAX) - y,
    },
    ...(typeof trackId === 'number' ? { trackId } : {}),
  };
}

function objectResult(
  category: 'person' | 'vehicle',
  ev: AmcrestEvent,
): AmcrestClassification {
  // A Pulse is an instantaneous hit with no matching Stop, so it activates the
  // sensor and is flagged for the consumer to expire on its own.
  const momentary = ev.action === 'Pulse';
  const detections = payloadObjects(eventData(ev))
    .map(toDetection)
    .filter((d): d is AmcrestDetection => d !== undefined);
  return {
    kind: 'object',
    category,
    active: momentary || ev.action === 'Start',
    ...(detections.length > 0 ? { detections } : {}),
    ...(momentary ? { momentary: true } : {}),
  };
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
      return objectResult('person', ev);
    case 'SmartMotionVehicle':
      return objectResult('vehicle', ev);
    case 'FaceDetection':
      return objectResult('person', ev);
    case 'CrossLineDetection':
    case 'CrossRegionDetection': {
      const category = objectTypeToCategory(eventData(ev)?.Object?.ObjectType);
      if (!category) return undefined;
      return objectResult(category, ev);
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
