import { classifyDevice } from './device.js';

export interface TalkbackTarget {
  codec: 'aac' | 'pcm_alaw';
  contentType: 'Audio/AAC' | 'Audio/G.711A';
  sampleRate: number;
}

export function selectTalkbackTarget(
  deviceType: string | undefined,
): TalkbackTarget {
  const { family } = classifyDevice(deviceType);
  if (family === 'dahua') {
    return { codec: 'pcm_alaw', contentType: 'Audio/G.711A', sampleRate: 8000 };
  }
  return { codec: 'aac', contentType: 'Audio/AAC', sampleRate: 16000 };
}
