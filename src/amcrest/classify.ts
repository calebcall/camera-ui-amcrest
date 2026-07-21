import type { AmcrestEvent } from './events.js';

export type AmcrestClassification =
  { kind: 'motion'; active: boolean } | { kind: 'audio'; active: boolean } | { kind: 'object'; category: 'person' | 'vehicle'; active: boolean } | { kind: 'doorbell' };

function objectTypeToCategory(objectType?: string): 'person' | 'vehicle' | undefined {
  if (objectType === 'Human') return 'person';
  if (objectType === 'Vehicle') return 'vehicle';
  return undefined;
}

export function classifyAmcrestEvent(ev: AmcrestEvent): AmcrestClassification | undefined {
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
      return { kind: 'object', category: 'person', active };
    case 'CrossLineDetection':
    case 'CrossRegionDetection': {
      const objectType = (ev.data as { Object?: { ObjectType?: string } } | undefined)?.Object?.ObjectType;
      const category = objectTypeToCategory(objectType);
      if (!category) return undefined;
      return { kind: 'object', category, active };
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
