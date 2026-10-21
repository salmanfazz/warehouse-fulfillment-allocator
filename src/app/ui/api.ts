// The envelope every API response has, errors included.
export type Envelope<T = unknown> = { guid: string; code: number; info: string; data: T };

export type ApiResult<T> =
  | { kind: 'envelope'; status: number; body: Envelope<T> }
  | { kind: 'unexpected'; status: number } // an answer that is not the envelope (an HTML error page, an empty body)
  | { kind: 'network' }; // no answer at all

const KEYS = ['code', 'data', 'guid', 'info'];

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join() === KEYS.join() &&
    typeof record.code === 'number' &&
    typeof record.info === 'string' &&
    typeof record.guid === 'string'
  );
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// Calls the API and never throws: whatever happens is described by the result, so the page can
// always show something and re-enable its buttons.
export async function callApi<T>(
  path: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = defaultFetch,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch {
    return { kind: 'network' };
  }
  try {
    const body: unknown = await response.json();
    return isEnvelope(body)
      ? { kind: 'envelope', status: response.status, body: body as Envelope<T> }
      : { kind: 'unexpected', status: response.status };
  } catch {
    return { kind: 'unexpected', status: response.status };
  }
}
