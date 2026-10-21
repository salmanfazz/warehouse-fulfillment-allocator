import { fail, toResponse, type Reply } from './envelope';
import { ApiError } from './errors';

// postgres.js and Node connection failures: the database cannot be reached.
const DOWN_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  '53300', // too many connections
  '57P01', // admin shutdown
]);

export function isDatabaseDown(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return DOWN_CODES.has(code) || code.startsWith('08'); // SQLSTATE class 08: connection exception
}

function logError(guid: string, err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(JSON.stringify({ guid, message: e.message, stack: e.stack }));
}

function errorToReply(guid: string, err: unknown): Reply {
  if (err instanceof ApiError) {
    if (err.status >= 500) logError(guid, err.cause ?? err);
    return fail(err.status, err.info, err.data);
  }
  logError(guid, err);
  if (isDatabaseDown(err)) return fail(503, 'Service temporarily unavailable');
  return fail(500, 'Something went wrong');
}

type Handler<C> = (req: Request, ctx: C, meta: { guid: string }) => Reply | Promise<Reply>;

// Wraps a route handler: new guid per request, same envelope for success and errors,
// and never leaks the real error to the client.
export function withEnvelope<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const guid = crypto.randomUUID();
    try {
      return toResponse(guid, await handler(req, ctx, { guid }));
    } catch (err) {
      return toResponse(guid, errorToReply(guid, err));
    }
  };
}
