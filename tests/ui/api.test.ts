import { describe, expect, it, vi } from 'vitest';
import { callApi } from '@/app/ui/api';

const envelope = (code: number, data: unknown = null, info = 'message') => ({
  guid: '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e',
  code,
  info,
  data,
});
const respond = (
  status: number,
  body: BodyInit | null,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) => vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;

describe('callApi', () => {
  it('returns_the_envelope_for_every_status_the_api_uses', async () => {
    for (const status of [200, 201, 400, 404, 405, 422, 500, 503]) {
      const result = await callApi(
        '/x',
        {},
        respond(status, JSON.stringify(envelope(status, { a: 1 }))),
      );
      expect(result.kind, String(status)).toBe('envelope');
      if (result.kind === 'envelope') {
        expect(result.status).toBe(status);
        expect(result.body.code).toBe(status);
        expect(result.body.data).toEqual({ a: 1 });
      }
    }
  });

  it('html_body_is_unexpected_with_its_status', async () => {
    const result = await callApi(
      '/x',
      {},
      respond(502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' }),
    );
    expect(result).toEqual({ kind: 'unexpected', status: 502 });
  });

  it('empty_body_is_unexpected', async () => {
    expect(await callApi('/x', {}, respond(204, null))).toEqual({
      kind: 'unexpected',
      status: 204,
    });
    expect(await callApi('/x', {}, respond(500, ''))).toEqual({ kind: 'unexpected', status: 500 });
  });

  it('json_without_the_four_keys_is_unexpected', async () => {
    for (const body of [
      {},
      [],
      null,
      'text',
      5,
      { guid: 'x', code: 200, info: 'ok' },
      { ...envelope(200), extra: 1 },
      { ...envelope(200), code: '200' },
    ]) {
      const result = await callApi('/x', {}, respond(200, JSON.stringify(body)));
      expect(result, JSON.stringify(body)).toEqual({ kind: 'unexpected', status: 200 });
    }
  });

  it('fetch_rejecting_is_network', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await callApi('/x', {}, failing)).toEqual({ kind: 'network' });
  });

  it('never_throws', async () => {
    const weird = vi.fn(
      async () =>
        ({
          status: 200,
          json: async () => {
            throw new Error('boom');
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(callApi('/x', {}, weird)).resolves.toEqual({ kind: 'unexpected', status: 200 });
  });

  it('sends_path_method_and_body_through', async () => {
    const fake = respond(201, JSON.stringify(envelope(201)));
    await callApi('/api/v1/orders', { method: 'POST', body: '{"items":[]}' }, fake);
    expect(fake).toHaveBeenCalledWith('/api/v1/orders', { method: 'POST', body: '{"items":[]}' });
  });
});
