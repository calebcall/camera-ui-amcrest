// Cleans a single multipart section: strips MIME headers (payload starts after the
// first blank line), drops stray "HTTP/1.x 200 OK" status lines, and only keeps
// sections that actually carry an Amcrest event (`Code=`). Shared by both the
// one-shot splitter below and the streaming extractor.
function cleanEventSection(section: string): string | undefined {
  const trimmed = section.trim();
  if (!trimmed || trimmed === '--') return undefined;

  // Drop MIME headers: the payload is after the first blank line.
  const sepIdx = trimmed.indexOf('\r\n\r\n');
  const payload = sepIdx !== -1 ? trimmed.substring(sepIdx + 4) : trimmed;
  const cleaned = payload
    .split(/\r?\n/)
    .filter((line) => line && !/^HTTP\/1\.[01] 200 OK$/.test(line.trim()))
    .join('\n')
    .trim();

  return cleaned.includes('Code=') ? cleaned : undefined;
}

export function splitEventMultipart(chunk: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const spaced = `-- ${boundary}`;
  const normalized = chunk.split(spaced).join(marker);

  const parts = normalized.split(marker);
  const blobs: string[] = [];

  for (const part of parts) {
    const cleaned = cleanEventSection(part);
    if (cleaned) blobs.push(cleaned);
  }

  return blobs;
}

/**
 * Extracts every COMPLETE event section from an accumulating stream buffer.
 *
 * A section is only considered complete when it is followed by a subsequent
 * boundary marker — i.e. it is bounded on both sides. The trailing section
 * after the last boundary marker is by definition still being received, so it
 * is returned as `rest` (never emitted as a blob) for the caller to prepend to
 * the next chunk. This guarantees each complete event is emitted exactly once,
 * regardless of how the underlying chunks are split.
 */
export function extractCompleteEvents(buffer: string, boundary: string): { blobs: string[]; rest: string } {
  const marker = `--${boundary}`;
  const spaced = `-- ${boundary}`;
  const normalized = buffer.split(spaced).join(marker);

  const indices: number[] = [];
  let idx = normalized.indexOf(marker);
  while (idx !== -1) {
    indices.push(idx);
    idx = normalized.indexOf(marker, idx + marker.length);
  }

  if (indices.length === 0) {
    return { blobs: [], rest: buffer };
  }

  const blobs: string[] = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const start = indices[i] + marker.length;
    const end = indices[i + 1];
    const cleaned = cleanEventSection(normalized.substring(start, end));
    if (cleaned) blobs.push(cleaned);
  }

  // The section after the last marker is not yet known to be complete; keep it
  // (starting at the marker itself) so the next chunk can complete it.
  const rest = normalized.substring(indices[indices.length - 1]);
  return { blobs, rest };
}
