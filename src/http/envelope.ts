// Live data (stock, orders) must never be served from a cache.
export const NO_STORE = { 'Cache-Control': 'no-store' };

export type Reply = {
  status: number;
  info: string;
  data: unknown;
  headers?: Record<string, string>;
};

export function ok(
  data: unknown,
  info = 'OK',
  init: { status?: number; headers?: Record<string, string> } = {},
): Reply {
  return { status: init.status ?? 200, info, data, headers: init.headers };
}

export function fail(
  status: number,
  info: string,
  data: unknown = null,
  headers?: Record<string, string>,
): Reply {
  return { status, info, data, headers };
}

// Every response body has exactly these four keys; `code` repeats the HTTP status.
export function toResponse(guid: string, reply: Reply): Response {
  const body = { guid, code: reply.status, info: reply.info, data: reply.data };
  return Response.json(body, {
    status: reply.status,
    headers: { ...reply.headers, 'X-Request-Id': guid },
  });
}
