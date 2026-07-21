export interface AmcrestEvent {
  code: string;
  action: string;
  index?: number;
  data?: unknown;
}

export function parseAmcrestEvent(blob: string): AmcrestEvent | undefined {
  const codeMatch = /Code=([^;]+)/.exec(blob);
  if (!codeMatch) return undefined;

  const actionMatch = /action=([^;]+)/.exec(blob);
  const indexMatch = /index=([0-9]+)/.exec(blob);

  // data= may itself contain ';' inside JSON, so capture everything after 'data='.
  const dataIdx = blob.indexOf('data=');
  let data: unknown;
  if (dataIdx !== -1) {
    const raw = blob.substring(dataIdx + 'data='.length).trim();
    try {
      data = JSON.parse(raw);
    } catch {
      data = undefined;
    }
  }

  return {
    code: codeMatch[1].trim(),
    action: actionMatch ? actionMatch[1].trim() : '',
    index: indexMatch ? parseInt(indexMatch[1], 10) : undefined,
    data,
  };
}
