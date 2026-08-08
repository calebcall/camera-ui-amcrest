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

/** Longest slice of a rejection body worth putting in the log. */
const DETAIL_LIMIT = 200;

/**
 * What to say about the status audio.cgi answered a talkback POST with, or
 * undefined when it accepted the stream.
 *
 * Exists because a rejection is otherwise invisible: fetch resolves for 4xx and
 * 5xx, so without inspecting the status the audio silently goes nowhere. Which
 * status a model returns is the whole diagnostic — the codec, the credentials
 * and "this device has no native talkback at all" are three different failures
 * that look identical from the outside.
 */
export function describeTalkbackRejection(
  status: number,
  statusText: string,
  body: string,
): string | undefined {
  if (status >= 200 && status < 300) return undefined;

  const label = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
  // Amcrest/Dahua CGI explains refusals in a short plain-text body. Collapse the
  // whitespace so a multi-line answer stays on one log line.
  const detail = body.trim().replace(/\s+/g, ' ').slice(0, DETAIL_LIMIT);
  const parts = [`Camera rejected talkback audio: ${label}`];
  if (detail) parts.push(detail);
  const hint = talkbackHint(status);
  if (hint) parts.push(hint);
  return parts.join(' — ');
}

function talkbackHint(status: number): string | undefined {
  switch (status) {
    case 400:
      return 'the device would not accept this audio codec — it may want a different one than its device type implies';
    case 401:
      return 'check the credentials; talkback needs an account with audio permission';
    case 403:
      return 'the account is not permitted to send audio to this device';
    case 404:
      return 'this device does not expose the native audio.cgi talkback endpoint';
    default:
      return undefined;
  }
}
