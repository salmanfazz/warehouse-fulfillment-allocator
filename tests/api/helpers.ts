import { expect } from 'vitest';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type Envelope = { guid: string; code: number; info: string; data: unknown };
type Handler = (req: Request, ctx: unknown) => Promise<Response>;

// Reads a response and checks everything every API response must satisfy: exactly the four keys,
// a UUID guid equal to X-Request-Id, code equal to the HTTP status, and a JSON content type.
export async function readEnvelope(res: Response) {
  const text = await res.text();
  const body = JSON.parse(text) as Envelope;
  expect(Object.keys(body).sort()).toEqual(['code', 'data', 'guid', 'info']);
  expect(body.code).toBe(res.status);
  expect(body.guid).toMatch(UUID);
  expect(res.headers.get('x-request-id')).toBe(body.guid);
  expect(res.headers.get('content-type')).toContain('application/json');
  return { body, text };
}

// Calls a route module's handler for a method. `path` is the URL path; `ctx` is the Next.js context.
export function callRoute(
  mod: object,
  method: string,
  path: string,
  init: { body?: string; headers?: Record<string, string> } = {},
  ctx: unknown = undefined,
) {
  const handler = (mod as Record<string, unknown>)[method] as Handler | undefined;
  if (!handler) throw new Error(`The route does not export ${method}`);
  const req = new Request(`http://localhost${path}`, { method, ...init });
  return handler(req, ctx);
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) });
