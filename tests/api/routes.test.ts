import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as catchAll from '@/app/api/[[...path]]/route';
import * as health from '@/app/api/health/route';
import { getSql } from '@/db/client';

vi.mock('@/db/client', () => ({ getSql: vi.fn() }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Envelope = { guid: string; code: number; info: string; data: unknown };

async function read(res: Response) {
  const body = (await res.json()) as Envelope;
  expect(Object.keys(body).sort()).toEqual(['code', 'data', 'guid', 'info']);
  expect(body.code).toBe(res.status);
  expect(body.guid).toMatch(UUID);
  expect(res.headers.get('x-request-id')).toBe(body.guid);
  expect(res.headers.get('content-type')).toContain('application/json');
  return body;
}

const request = (path: string, method = 'GET') =>
  new Request(`http://localhost${path}`, { method });

function sqlThatAnswers() {
  vi.mocked(getSql).mockReturnValue((() => Promise.resolve([{ ok: 1 }])) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/health', () => {
  it('health_200_when_select_1_works', async () => {
    sqlThatAnswers();
    const res = await health.GET(request('/api/health'), undefined);
    const body = await read(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ status: 'ok' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('health_503_when_the_query_fails', async () => {
    vi.mocked(getSql).mockReturnValue((() =>
      Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      )) as never);
    const res = await health.GET(request('/api/health'), undefined);
    const body = await read(res);
    expect(res.status).toBe(503);
    expect(body.data).toBeNull();
    expect(body.info).toBe('Database unavailable');
  });

  it('health_503_when_the_client_cannot_be_created', async () => {
    vi.mocked(getSql).mockImplementation(() => {
      throw new Error('DATABASE_URL is not set');
    });
    const res = await health.GET(request('/api/health'), undefined);
    const body = await read(res);
    expect(res.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'health_%s_is_405_with_allow_get_and_envelope',
    async (method) => {
      const res = await health[method](request('/api/health', method), undefined);
      const body = await read(res);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(body.data).toBeNull();
    },
  );
});

// These call the handler directly and it ignores the path, so they prove the reply, not the routing.
// Routing (bare /api, nested paths, trailing slash) is checked by curl against the dev server.
describe('catch-all', () => {
  it.each(['/api/nope', '/api', '/api/v1/nope/deep'])(
    'catch_all_handler_replies_404_envelope_for_get_%s',
    async (path) => {
      const res = await catchAll.GET(request(path), undefined);
      const body = await read(res);
      expect(res.status).toBe(404);
      expect(body.data).toBeNull();
      expect(body.info).toBe('Route not found');
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'catch_all_handler_replies_404_envelope_for_%s',
    async (method) => {
      const res = await catchAll[method](request('/api/nope', method), undefined);
      expect(res.status).toBe(404);
      await read(res);
    },
  );
});
