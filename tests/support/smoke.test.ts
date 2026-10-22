import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, runSmoke, type CheckResult } from '../../scripts/smoke';
import { BASELINE_STOCK } from '@/db/seed-data';

const WAREHOUSES = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08'];
const PRODUCTS = ['P001', 'P002', 'P003', 'P004', 'P005'];
const COLD_CAPABLE = ['W04', 'W07', 'W08']; // where Hep B can ship from
const SECRET = 's3cret-value-123';

type Options = {
  stockOverride?: Record<string, number>; // "W04/P002" -> quantity
  existingOrders?: number;
  wrongStockAfterPlace?: boolean; // the place does not take the vials it promised
  lenientConcurrency?: boolean; // both simultaneous orders succeed (an oversell)
  htmlHealth?: boolean;
  noTitle?: boolean;
  placeThrows?: boolean; // the connection drops on the place request
  resetStatus?: number; // what reset answers (the database is still reset)
  pairReason?: string; // the reason the rejected order of the pair carries
};

// A small in-memory stand-in for the API: the documented paths and envelopes, Hep B only, and one
// request handled at a time (as the row locks do on the real database).
function fakeApi(options: Options = {}) {
  const stock = new Map<string, number>();
  for (const w of WAREHOUSES) for (const p of PRODUCTS) stock.set(`${w}/${p}`, 0);
  for (const row of BASELINE_STOCK)
    stock.set(`${row.warehouse_id}/${row.product_id}`, row.quantity);
  for (const [key, quantity] of Object.entries(options.stockOverride ?? {}))
    stock.set(key, quantity);
  const orders: { orderId: string; plan: Record<string, unknown> }[] = Array.from(
    { length: options.existingOrders ?? 0 },
    (_, i) => ({ orderId: `existing-${i}`, plan: { shipments: [] } }),
  );
  const calls: string[] = [];
  const authSeen: string[] = [];
  let nextId = 1;

  const envelope = (status: number, data: unknown, info = 'message', headers: HeadersInit = {}) =>
    new Response(JSON.stringify({ guid: 'g', code: status, info, data }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  function plan(quantity: number, take: boolean, lenient = false) {
    const shippable = COLD_CAPABLE.reduce((sum, w) => sum + (stock.get(`${w}/P002`) ?? 0), 0);
    if (shippable < quantity && !lenient) {
      return { rejected: { reason: 'COLD_CHAIN_UNAVAILABLE', shortfalls: [] } };
    }
    let left = quantity;
    const shipments: { warehouseId: string; items: { productId: string; quantity: number }[] }[] =
      [];
    for (const w of COLD_CAPABLE) {
      const available = stock.get(`${w}/P002`) ?? 0;
      const got = Math.min(left, available);
      if (got <= 0) continue;
      shipments.push({ warehouseId: w, items: [{ productId: 'P002', quantity: got }] });
      if (take && !options.wrongStockAfterPlace) stock.set(`${w}/P002`, available - got);
      left -= got;
    }
    return {
      data: {
        orderedAt: 'x',
        shipments,
        totalMinutes: 1,
        totalCost: 1,
        reasons: [],
        alternatives: [],
      },
    };
  }

  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = new Headers(init?.headers).get('authorization');
    if (auth) authSeen.push(auth);

    if (path === '/' && method === 'GET') {
      return new Response(
        options.noTitle ? '<html>nothing</html>' : '<title>Warehouse Fulfillment Allocator</title>',
        { status: 200 },
      );
    }
    if (path === '/api/health') {
      return options.htmlHealth
        ? new Response('<html>Bad Gateway</html>', { status: 502 })
        : envelope(200, { status: 'ok' });
    }
    if (path === '/api/cron/keep-alive') {
      return auth === `Bearer ${SECRET}`
        ? envelope(200, { status: 'ok' })
        : envelope(401, null, 'Unauthorized');
    }
    if (path === '/api/v1/warehouses') {
      return envelope(200, {
        warehouses: WAREHOUSES.map((id) => ({
          id,
          stock: Object.fromEntries(PRODUCTS.map((p) => [p, stock.get(`${id}/${p}`) ?? 0])),
        })),
      });
    }
    if (path === '/api/v1/orders' && method === 'GET') {
      return envelope(200, { orders: orders.map((o) => ({ orderId: o.orderId })) });
    }
    if (path.startsWith('/api/v1/orders/') && method === 'GET') {
      const found = orders.find((o) => o.orderId === path.split('/').pop());
      return found ? envelope(200, found.plan) : envelope(404, null, 'Order not found');
    }
    if (path === '/api/v1/orders/preview') {
      const outcome = plan(body.items[0].quantity, false);
      return outcome.rejected ? envelope(422, outcome.rejected) : envelope(200, outcome.data);
    }
    if (path === '/api/v1/orders' && method === 'POST') {
      if (options.placeThrows) throw new TypeError('fetch failed');
      const outcome = plan(body.items[0].quantity, true, options.lenientConcurrency);
      if (outcome.rejected)
        return envelope(body.items[0].quantity > 158 ? 422 : 422, {
          reason:
            body.items[0].quantity > 158
              ? 'INSUFFICIENT_STOCK'
              : (options.pairReason ?? 'COLD_CHAIN_UNAVAILABLE'),
          shortfalls: [],
        });
      const orderId = `order-${nextId++}`;
      const placed = { orderId, ...outcome.data };
      orders.push({ orderId, plan: placed });
      return envelope(201, placed, 'created', { location: `/api/v1/orders/${orderId}` });
    }
    if (path === '/api/v1/reset' && method === 'POST') {
      orders.length = 0;
      for (const w of WAREHOUSES) for (const p of PRODUCTS) stock.set(`${w}/${p}`, 0);
      for (const row of BASELINE_STOCK)
        stock.set(`${row.warehouse_id}/${row.product_id}`, row.quantity);
      return envelope(options.resetStatus ?? 200, null, 'Demo data reset to baseline');
    }
    return envelope(404, null, 'Route not found');
  }) as typeof fetch;

  return { doFetch, calls, stock, orders, authSeen };
}

const status = (results: CheckResult[], name: RegExp) =>
  results.find((r) => name.test(r.name))?.status;
const writes = (calls: string[]) =>
  calls.filter((c) => c === 'POST /api/v1/orders' || c === 'POST /api/v1/reset');

describe('runSmoke', () => {
  it('a_healthy_api_passes_every_check', async () => {
    const api = fakeApi();
    const results = await runSmoke('https://demo.test', api.doFetch, { cronSecret: SECRET });
    expect(results.filter((r) => r.status !== 'pass').map((r) => `${r.name}: ${r.detail}`)).toEqual(
      [],
    );
    expect(status(results, /keep-alive with the secret/)).toBe('pass');
    expect(api.orders).toHaveLength(0); // everything was cleaned up
    expect(api.stock.get('W04/P002')).toBe(40);
  });

  it('skips_the_keep_alive_200_check_without_a_secret', async () => {
    const results = await runSmoke('https://demo.test', fakeApi().doFetch);
    expect(status(results, /keep-alive with the secret/)).toBe('skip');
    expect(results.some((r) => r.status === 'fail')).toBe(false);
  });

  it('stops_before_writing_when_the_database_is_not_clean', async () => {
    for (const options of [{ stockOverride: { 'W04/P002': 39 } }, { existingOrders: 1 }]) {
      const api = fakeApi(options);
      const results = await runSmoke('https://demo.test', api.doFetch);
      expect(status(results, /database is clean/)).toBe('fail');
      expect(writes(api.calls)).toEqual([]);
    }
  });

  it('resets_even_when_a_check_after_the_order_fails', async () => {
    const api = fakeApi({ wrongStockAfterPlace: true });
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(results.some((r) => r.status === 'fail')).toBe(true);
    expect(api.calls.filter((c) => c === 'POST /api/v1/reset')).toHaveLength(1);
    expect(api.orders).toHaveLength(0);
  });

  it('the_concurrent_pair_gives_one_201_and_one_422', async () => {
    const api = fakeApi();
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(status(results, /concurrent pair/)).toBe('pass');
  });

  it('an_oversell_in_the_concurrent_pair_is_a_failure_and_is_cleaned_up', async () => {
    const api = fakeApi({ lenientConcurrency: true });
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(status(results, /concurrent pair/)).toBe('fail');
    expect(api.orders).toHaveLength(0);
  });

  it('a_non_envelope_answer_is_a_failure_not_a_crash', async () => {
    const results = await runSmoke('https://demo.test', fakeApi({ htmlHealth: true }).doFetch);
    expect(status(results, /health/)).toBe('fail');
  });

  it('checks_after_a_failed_required_check_are_reported_as_skipped_not_dropped', async () => {
    const results = await runSmoke('https://demo.test', fakeApi({ existingOrders: 1 }).doFetch);
    expect(status(results, /preview of/)).toBe('skip');
    expect(status(results, /concurrent pair/)).toBe('skip');
    expect(results.find((r) => /preview of/.test(r.name))?.detail).toMatch(
      /earlier required check/,
    );
  });

  it('a_place_that_loses_its_connection_still_triggers_one_cleanup_reset', async () => {
    const api = fakeApi({ placeThrows: true });
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(status(results, /place order/)).toBe('fail');
    expect(api.calls.filter((c) => c === 'POST /api/v1/reset')).toHaveLength(1);
    expect(status(results, /cleanup reset/)).toBe('pass');
  });

  it('a_cleanup_reset_that_fails_is_reported', async () => {
    const api = fakeApi({ wrongStockAfterPlace: true, resetStatus: 500 });
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(status(results, /cleanup reset/)).toBe('fail');
  });

  it('the_rejected_order_of_the_pair_must_carry_the_expected_reason', async () => {
    const api = fakeApi({ pairReason: 'INSUFFICIENT_STOCK' });
    const results = await runSmoke('https://demo.test', api.doFetch);
    expect(status(results, /concurrent pair/)).toBe('fail');
  });

  it('the_secret_is_not_sent_over_plain_http_except_to_localhost', async () => {
    const remote = fakeApi();
    const remoteResults = await runSmoke('http://demo.test', remote.doFetch, {
      cronSecret: SECRET,
    });
    expect(status(remoteResults, /keep-alive with the secret/)).toBe('skip');
    expect(remote.authSeen).toEqual([]);

    const local = fakeApi();
    const localResults = await runSmoke('http://localhost:3000', local.doFetch, {
      cronSecret: SECRET,
    });
    expect(status(localResults, /keep-alive with the secret/)).toBe('pass');
  });

  it('the_page_check_needs_a_200_with_the_title', async () => {
    const results = await runSmoke('https://demo.test', fakeApi({ noTitle: true }).doFetch);
    expect(status(results, /page/)).toBe('fail');
  });

  it('the_secret_never_appears_in_any_result', async () => {
    const results = await runSmoke('https://demo.test', fakeApi().doFetch, { cronSecret: SECRET });
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });
});

describe('normalizeBaseUrl', () => {
  it('removes_a_trailing_slash', () => {
    expect(normalizeBaseUrl('https://x.vercel.app/')).toBe('https://x.vercel.app');
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects_other_schemes_paths_and_garbage', () => {
    expect(() => normalizeBaseUrl('ftp://x.app')).toThrow();
    expect(() => normalizeBaseUrl('https://x.app/path')).toThrow();
    expect(() => normalizeBaseUrl('https://x.app/?a=1')).toThrow();
    expect(() => normalizeBaseUrl('not a url')).toThrow();
  });
});
