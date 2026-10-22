import { describe, expect, it } from 'vitest';
import { TABLES, checkTables } from '../../scripts/check-data-api';

const KEY = 'anon-key-value-abc123';
const BASE = 'https://ref.supabase.co';

function fakeFetch(answer: (table: string) => Response | Error) {
  const requests: { url: string; headers: Headers }[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    const table = new URL(url).pathname.split('/').pop() as string;
    const result = answer(table);
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { doFetch, requests };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const denied = (status = 401) =>
  json(status, { code: '42501', message: 'permission denied for table stock' });

describe('checkTables', () => {
  it('requests_all_six_tables_with_select_and_limit', async () => {
    const { doFetch, requests } = fakeFetch(() => denied());
    await checkTables(BASE, KEY, doFetch);
    expect([...TABLES].sort()).toEqual([
      'delivery_records',
      'orders',
      'products',
      'schema_migrations',
      'stock',
      'warehouses',
    ]);
    expect(requests.map((r) => r.url).sort()).toEqual(
      [...TABLES].sort().map((t) => `${BASE}/rest/v1/${t}?select=*&limit=1`),
    );
  });

  it('401_403_404_and_an_empty_200_pass', async () => {
    const answers: Record<string, Response> = {
      products: denied(401),
      warehouses: denied(403),
      stock: json(404, {
        code: 'PGRST205',
        message: 'Could not find the table in the schema cache',
      }),
      delivery_records: json(200, []),
      orders: denied(401),
      schema_migrations: denied(401),
    };
    const { doFetch } = fakeFetch((t) => answers[t]!.clone());
    const results = await checkTables(BASE, KEY, doFetch);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('a_200_with_a_row_fails', async () => {
    const { doFetch } = fakeFetch((t) => (t === 'stock' ? json(200, [{ quantity: 1 }]) : denied()));
    const results = await checkTables(BASE, KEY, doFetch);
    expect(results.filter((r) => !r.ok).map((r) => r.table)).toEqual(['stock']);
  });

  it('a_refusal_that_did_not_come_from_the_database_fails', async () => {
    // A wrong key or project ref is refused too, but not with a database error code. That must not
    // look like a pass, because nothing about the tables was tested.
    const bodies: Response[] = [
      json(401, { message: 'Invalid API key' }),
      json(404, {}),
      new Response('<html>Not found</html>', { status: 404 }),
    ];
    for (const body of bodies) {
      const { doFetch } = fakeFetch(() => body.clone());
      const results = await checkTables(BASE, KEY, doFetch);
      expect(results.every((r) => !r.ok)).toBe(true);
    }
  });

  it('the_database_error_code_is_reported_next_to_the_status', async () => {
    const { doFetch } = fakeFetch(() => denied());
    const results = await checkTables(BASE, KEY, doFetch);
    expect(results.every((r) => r.code === '42501' && r.status === 401)).toBe(true);
  });

  it('400_and_5xx_fail', async () => {
    for (const status of [400, 500, 503]) {
      const { doFetch } = fakeFetch(() => json(status, {}));
      const results = await checkTables(BASE, KEY, doFetch);
      expect(
        results.every((r) => !r.ok),
        `status ${status}`,
      ).toBe(true);
    }
  });

  it('a_network_error_fails', async () => {
    const { doFetch } = fakeFetch(() => new Error('connect ECONNREFUSED'));
    const results = await checkTables(BASE, KEY, doFetch);
    expect(results.every((r) => !r.ok && r.status === 'error')).toBe(true);
  });

  it('the_key_is_sent_as_apikey_and_bearer_but_never_returned', async () => {
    const { doFetch, requests } = fakeFetch(() => denied());
    const results = await checkTables(BASE, KEY, doFetch);
    for (const r of requests) {
      expect(r.headers.get('apikey')).toBe(KEY);
      expect(r.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    }
    expect(JSON.stringify(results)).not.toContain(KEY);
  });
});
