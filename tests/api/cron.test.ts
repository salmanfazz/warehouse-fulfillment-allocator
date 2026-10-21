import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as keepAlive from '@/app/api/cron/keep-alive/route';
import { getSql } from '@/db/client';
import { readEnvelope as read } from './helpers';

vi.mock('@/db/client', () => ({ getSql: vi.fn() }));

const THROWAWAY = 'throwaway-secret-for-tests-only';

const call = (headers: Record<string, string> = {}, method = 'GET') => {
  const req = new Request('http://localhost/api/cron/keep-alive', { method, headers });
  return (keepAlive as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[
    method
  ]!(req, undefined);
};
const databaseAnswers = () =>
  vi.mocked(getSql).mockReturnValue((() => Promise.resolve([{ ok: 1 }])) as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CRON_SECRET', THROWAWAY);
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/keep-alive', () => {
  it('keep_alive_without_header_is_401_and_does_not_touch_the_database', async () => {
    const res = await call();
    const { body } = await read(res);
    expect(res.status).toBe(401);
    expect(body).toMatchObject({ info: 'Unauthorized', data: null });
    expect(getSql).not.toHaveBeenCalled();
  });

  it('keep_alive_with_wrong_secret_is_401', async () => {
    const res = await call({ Authorization: 'Bearer not-the-secret' });
    expect(res.status).toBe(401);
    await read(res);
    expect(getSql).not.toHaveBeenCalled();
  });

  it('keep_alive_with_other_schemes_is_401', async () => {
    for (const value of [THROWAWAY, `Basic ${THROWAWAY}`, `Token ${THROWAWAY}`, 'Bearer ']) {
      const res = await call({ Authorization: value });
      expect(res.status).toBe(401);
    }
  });

  it('keep_alive_with_right_secret_is_200_no_store', async () => {
    databaseAnswers();
    const res = await call({ Authorization: `Bearer ${THROWAWAY}` });
    const { body } = await read(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ info: 'Database reachable', data: { status: 'ok' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keep_alive_with_unset_secret_is_401_even_with_a_header', async () => {
    vi.stubEnv('CRON_SECRET', '');
    for (const value of ['Bearer ', 'Bearer undefined', `Bearer ${THROWAWAY}`]) {
      expect((await call({ Authorization: value })).status, value).toBe(401);
    }
    expect(getSql).not.toHaveBeenCalled();
  });

  it('keep_alive_database_down_is_503_and_generic', async () => {
    vi.mocked(getSql).mockReturnValue((() =>
      Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:6543'), { code: 'ECONNREFUSED' }),
      )) as never);
    const res = await call({ Authorization: `Bearer ${THROWAWAY}` });
    const { body, text } = await read(res);
    expect(res.status).toBe(503);
    expect(body.info).toBe('Database unavailable');
    expect(text.includes('10.1.2.3')).toBe(false);
  });

  it('keep_alive_post_is_405_with_allow_get_and_options_matches', async () => {
    const post = await call({ Authorization: `Bearer ${THROWAWAY}` }, 'POST');
    await read(post);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    const options = await call({}, 'OPTIONS');
    await read(options);
    expect(options.status).toBe(200);
    expect(options.headers.get('allow')).toBe('GET');
  });

  it('the_responses_never_contain_the_secret', async () => {
    databaseAnswers();
    const responses = [
      await call(),
      await call({ Authorization: `Bearer ${THROWAWAY}` }),
      await call({ Authorization: `Bearer ${THROWAWAY}x` }),
      await call({ Authorization: `Bearer ${THROWAWAY}` }, 'POST'),
    ];
    for (const res of responses) {
      const text = await res.text();
      expect(text.includes(THROWAWAY)).toBe(false); // a boolean, so a failure never prints the value
      expect([...res.headers.values()].some((v) => v.includes(THROWAWAY))).toBe(false);
    }
  });
});
