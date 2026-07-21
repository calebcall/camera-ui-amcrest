import { createHash, randomBytes } from 'node:crypto';

export interface DigestParams {
  username: string;
  password: string;
  realm: string;
  nonce: string;
  method: string;
  uri: string;
  qop?: string;
  nc?: string;
  cnonce?: string;
  opaque?: string;
  algorithm?: string;
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');

export function parseWwwAuthenticate(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = header.replace(/^Digest\s+/i, '');
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}

export function selectQop(
  challengeQop: string | undefined,
): string | undefined {
  if (!challengeQop) return undefined;
  const tokens = challengeQop
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  return tokens.includes('auth') ? 'auth' : undefined;
}

export function buildDigestAuthHeader(p: DigestParams): string {
  const qop = p.qop;
  const nc = p.nc ?? '00000001';
  const cnonce = p.cnonce ?? randomBytes(8).toString('hex');
  const ha1 = md5(`${p.username}:${p.realm}:${p.password}`);
  const ha2 = md5(`${p.method}:${p.uri}`);
  const response = qop
    ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${p.nonce}:${ha2}`);

  const parts = [
    `username="${p.username}"`,
    `realm="${p.realm}"`,
    `nonce="${p.nonce}"`,
    `uri="${p.uri}"`,
    `response="${response}"`,
  ];
  if (p.algorithm) parts.push(`algorithm=${p.algorithm}`);
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (p.opaque) parts.push(`opaque="${p.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

export interface DigestFetchOptions {
  url: string;
  username: string;
  password: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

export async function digestFetch(opts: DigestFetchOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  const first = await fetch(opts.url, {
    method,
    headers: opts.headers,
    signal: opts.signal,
  });
  if (first.status !== 401) {
    return first;
  }
  const challenge = first.headers.get('www-authenticate');
  if (!challenge) {
    return first;
  }
  // Drain the 401 body so the socket can be reused.
  await first.arrayBuffer().catch(() => undefined);

  const c = parseWwwAuthenticate(challenge);
  const u = new URL(opts.url);
  const uri = `${u.pathname}${u.search}`;
  const authHeader = buildDigestAuthHeader({
    username: opts.username,
    password: opts.password,
    realm: c.realm ?? '',
    nonce: c.nonce ?? '',
    method,
    uri,
    qop: selectQop(c.qop),
    opaque: c.opaque,
    algorithm: c.algorithm,
  });

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: { ...opts.headers, authorization: authHeader },
    body: opts.body,
    signal: opts.signal,
  };
  // Node's fetch requires an explicit duplex mode whenever a body is present
  // (e.g. a PassThrough stream for talkback audio); omitting it throws
  // "duplex option is required when sending a body".
  if (opts.body) {
    init.duplex = 'half';
  }

  return fetch(opts.url, init);
}
