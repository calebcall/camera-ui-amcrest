import type { Buffer } from 'node:buffer';

/** Longest slice of a rejection body worth putting in the log. */
const DETAIL_LIMIT = 200;

/**
 * Start-of-image marker. Every JPEG begins with it, and it is the only cheap
 * way to tell a picture from the plain-text refusal Amcrest CGI serves when it
 * will not take a snapshot request.
 */
const JPEG_SOI = [0xff, 0xd8, 0xff];

/** Shortest body that could plausibly be a picture rather than an error page. */
const MIN_JPEG_BYTES = 4;

function isJpeg(body: Buffer): boolean {
  if (body.byteLength < MIN_JPEG_BYTES) return false;
  return JPEG_SOI.every((byte, i) => body[i] === byte);
}

/**
 * What to say about the answer snapshot.cgi gave, or undefined when it handed
 * back a usable picture.
 *
 * Exists because a bad answer is otherwise invisible *and* load-bearing. fetch
 * resolves for 4xx and 5xx, so an unchecked body reaches camera.ui as if it
 * were an image — and camera.ui takes any non-empty body from a plugin, caches
 * it, and skips its own go2rtc fallback (`camera/controller.js`). So bytes that
 * are not a JPEG do not merely fail to render: they suppress the only thing
 * that could have rendered instead.
 *
 * That matters most where this snapshot is the only picture available. A camera
 * whose sole event is `VideoMotion` opens no detection segment, so camera.ui
 * has no moment crops to fall back on and the event thumbnail on the dashboard
 * is this JPEG or nothing at all.
 */
export function describeSnapshotRejection(
  status: number,
  statusText: string,
  body: Buffer,
): string | undefined {
  if (status < 200 || status >= 300) {
    const label = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
    const parts = [`Camera refused the snapshot request: ${label}`];
    const detail = bodyDetail(body);
    if (detail) parts.push(detail);
    const hint = snapshotHint(status);
    if (hint) parts.push(hint);
    return parts.join(' — ');
  }

  if (body.byteLength === 0) {
    return 'Camera answered the snapshot request with an empty body';
  }

  if (!isJpeg(body)) {
    const parts = [
      `Camera answered the snapshot request with ${body.byteLength} bytes that are not a JPEG`,
    ];
    const detail = bodyDetail(body);
    if (detail) parts.push(detail);
    return parts.join(' — ');
  }

  return undefined;
}

/** Tab, newline, carriage return and the printable ASCII range. */
function isReadableByte(byte: number): boolean {
  return (
    byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)
  );
}

/**
 * The body as one readable log fragment. Amcrest CGI explains refusals in a
 * short plain-text body, so it is worth quoting; a binary body that merely is
 * not a JPEG is not, and would wreck the log line.
 */
function bodyDetail(body: Buffer): string | undefined {
  const head = body.subarray(0, DETAIL_LIMIT);
  if (!head.every(isReadableByte)) return undefined;
  const collapsed = head.toString('utf8').trim().replace(/\s+/g, ' ');
  return collapsed || undefined;
}

function snapshotHint(status: number): string | undefined {
  switch (status) {
    case 400:
      return 'the device would not serve a snapshot for this channel — check that snapshots are enabled on the camera and that the channel number is right';
    case 403:
      return 'the account is not permitted to read snapshots from this device';
    case 404:
      return 'this device does not expose snapshot.cgi';
    case 503:
      return 'the device is out of spare connections — it is busy serving streams';
    default:
      return undefined;
  }
}
