import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as keepAlive from '@/app/api/cron/keep-alive/route';
import * as health from '@/app/api/health/route';
import * as orderById from '@/app/api/v1/orders/[id]/route';
import * as preview from '@/app/api/v1/orders/preview/route';
import * as orders from '@/app/api/v1/orders/route';
import * as products from '@/app/api/v1/products/route';
import * as reset from '@/app/api/v1/reset/route';
import * as warehouses from '@/app/api/v1/warehouses/route';
import { closeSql } from '@/db/client';
import { clearReferenceCache } from '@/db/reference';
import { BASELINE_STOCK } from '@/db/seed-data';
import { callRoute, params, readEnvelope } from '../api/helpers';
import { restoreBaseline, testSql } from './helpers';

// The handlers use the app's shared client (getSql), which the test config points at the test
// database. Restores and lock holders use the separate test client.
const sql = testSql();
afterAll(async () => {
  await closeSql(); // end the shared client and forget it, or a reused worker would get an ended one
  await sql.end();
});
beforeEach(async () => {
  clearReferenceCache();
  await restoreBaseline(sql);
});
afterEach(() => vi.unstubAllEnvs());

const AT = '2026-10-20T13:00:00+07:00'; // golden case G01's time
const order = (...items: [string, number][]) =>
  JSON.stringify({
    items: items.map(([productId, quantity]) => ({ productId, quantity })),
    orderedAt: AT,
  });
const post = (mod: object, path: string, body: string) => callRoute(mod, 'POST', path, { body });
const getOrder = (id: string) =>
  callRoute(orderById, 'GET', `/api/v1/orders/${id}`, {}, params(id));

type WarehouseJson = { id: string; stock: Record<string, number> };
async function stockMap() {
  const { body } = await readEnvelope(await callRoute(warehouses, 'GET', '/api/v1/warehouses'));
  const map = new Map<string, number>();
  for (const w of (body.data as { warehouses: WarehouseJson[] }).warehouses) {
    for (const [productId, quantity] of Object.entries(w.stock))
      map.set(`${w.id}/${productId}`, quantity);
  }
  return map;
}
// GET /warehouses lists every warehouse with every product, 0 where there is no stock row.
const baseline = new Map<string, number>();
for (const w of ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08']) {
  for (const p of ['P001', 'P002', 'P003', 'P004', 'P005']) baseline.set(`${w}/${p}`, 0);
}
for (const row of BASELINE_STOCK)
  baseline.set(`${row.warehouse_id}/${row.product_id}`, row.quantity);
const orderCount = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from orders`)[0]!.n;

describe('the API end to end', () => {
  it('full_flow_preview_place_read_list_reset', async () => {
    // preview: 200, a plan, nothing reserved, no order id
    const previewRes = await post(preview, '/api/v1/orders/preview', order(['P002', 45]));
    const previewBody = (await readEnvelope(previewRes)).body;
    expect(previewRes.status).toBe(200);
    expect(Object.keys(previewBody.data as object)).not.toContain('orderId');
    expect(await orderCount()).toBe(0);
    expect((await stockMap()).get('W04/P002')).toBe(40);

    // place: 201 with Location pointing at the new order
    const placeRes = await post(orders, '/api/v1/orders', order(['P002', 45]));
    const placed = await readEnvelope(placeRes);
    expect(placeRes.status).toBe(201);
    const data = placed.body.data as {
      orderId: string;
      shipments: { warehouseId: string; items: { quantity: number }[] }[];
    };
    expect(placeRes.headers.get('location')).toBe(`/api/v1/orders/${data.orderId}`);
    expect(data.shipments.map((s) => [s.warehouseId, s.items[0]!.quantity])).toEqual([
      ['W04', 40],
      ['W07', 5],
    ]);

    // reading it back gives exactly the same JSON text as the response that created it
    const readRes = await getOrder(data.orderId);
    const read = await readEnvelope(readRes);
    expect(readRes.status).toBe(200);
    expect(JSON.stringify(read.body.data)).toBe(JSON.stringify(placed.body.data));

    // stock went down where the plan said, and nowhere else
    const after = await stockMap();
    expect(after.get('W04/P002')).toBe(0);
    expect(after.get('W07/P002')).toBe(3);
    expect(after.get('W08/P002')).toBe(60);

    // the list shows the order, newest first
    const listBody = (await readEnvelope(await callRoute(orders, 'GET', '/api/v1/orders'))).body;
    const list = (listBody.data as { orders: { orderId: string; warehouseIds: string[] }[] })
      .orders;
    expect(list.map((o) => o.orderId)).toEqual([data.orderId]);
    expect(list[0]!.warehouseIds).toEqual(['W04', 'W07']);

    // reset: 200, orders gone, stock back to the baseline
    const resetRes = await callRoute(reset, 'POST', '/api/v1/reset');
    expect((await readEnvelope(resetRes)).body).toMatchObject({
      info: 'Demo data reset to baseline',
      data: null,
    });
    expect(resetRes.status).toBe(200);
    expect(await stockMap()).toEqual(baseline);
    const afterReset = (await readEnvelope(await callRoute(orders, 'GET', '/api/v1/orders'))).body;
    expect((afterReset.data as { orders: unknown[] }).orders).toEqual([]);
    expect((await readEnvelope(await getOrder(data.orderId))).body.info).toBe('Order not found');
  });

  it('products_lists_the_catalogue', async () => {
    const res = await callRoute(products, 'GET', '/api/v1/products');
    const { body } = await readEnvelope(res);
    expect((body.data as { products: { id: string }[] }).products.map((p) => p.id)).toEqual([
      'P001',
      'P002',
      'P003',
      'P004',
      'P005',
    ]);
  });

  it('shortfall_is_422_with_the_domains_message_and_changes_nothing', async () => {
    for (const path of ['/api/v1/orders/preview', '/api/v1/orders']) {
      const mod = path.endsWith('preview') ? preview : orders;
      const res = await post(mod, path, order(['P002', 120]));
      const { body } = await readEnvelope(res);
      expect(res.status, path).toBe(422);
      expect(res.headers.get('location'), path).toBeNull();
      expect(body.info).toBe(
        'Only 108 of 158 units of Vaccine - Hepatitis B (10-dose vial) can be shipped with cold chain',
      );
      expect(body.data).toEqual({
        reason: 'COLD_CHAIN_UNAVAILABLE',
        shortfalls: [{ productId: 'P002', requested: 120, available: 108 }],
      });
    }
    expect(await orderCount()).toBe(0);
    expect(await stockMap()).toEqual(baseline);
  });

  it('insufficient_stock_is_422', async () => {
    const res = await post(orders, '/api/v1/orders', order(['P001', 5000]));
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(422);
    expect(body.info).toBe(
      'Not enough stock for Surgical Gloves (Box of 100): requested 5000, available 1100',
    );
    expect((body.data as { reason: string }).reason).toBe('INSUFFICIENT_STOCK');
  });

  it('unknown_product_is_422_not_400', async () => {
    const res = await post(orders, '/api/v1/orders', order(['P999', 2]));
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(422);
    expect(body.info).toBe('Unknown product: P999');
    expect((body.data as { reason: string }).reason).toBe('UNKNOWN_PRODUCT');
  });

  it('an_invalid_body_is_400_and_changes_nothing', async () => {
    for (const body of [
      '{"items": []}',
      '{"items": [{"productId": "P001", "quantity": 1.5}]}',
      'not json',
      '',
    ]) {
      const res = await post(orders, '/api/v1/orders', body);
      await readEnvelope(res);
      expect(res.status, body).toBe(400);
    }
    expect(await orderCount()).toBe(0);
    expect(await stockMap()).toEqual(baseline);
  });

  it('an_unknown_or_malformed_order_id_is_404', async () => {
    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'not-a-uuid',
      '1;drop table orders',
      'x'.repeat(200),
    ]) {
      const res = await getOrder(encodeURIComponent(id));
      await readEnvelope(res);
      expect(res.status, id.slice(0, 20)).toBe(404);
    }
    expect(await orderCount()).toBe(0);
  });

  it('two_simultaneous_requests_for_the_last_vials_give_one_201_and_one_422', async () => {
    // exactly 10 Hep B vials can still be shipped (W02 and W06 still hold 50 that cannot be)
    await sql`update stock set quantity = case when warehouse_id = 'W04' then 10 else 0 end
              where product_id = 'P002' and warehouse_id in ('W04', 'W07', 'W08')`;
    const [a, b] = await Promise.all([
      post(orders, '/api/v1/orders', order(['P002', 10])),
      post(orders, '/api/v1/orders', order(['P002', 10])),
    ]);
    const bodies = [await readEnvelope(a), await readEnvelope(b)];
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    const rejected = bodies.find((x) => x.body.code === 422)!;
    expect((rejected.body.data as { reason: string }).reason).toBe('COLD_CHAIN_UNAVAILABLE');
    expect(await orderCount()).toBe(1);
    const map = await stockMap();
    expect(map.get('W04/P002')).toBe(0);
    expect([...map.values()].every((q) => q >= 0)).toBe(true);
  });
});

describe('what the schema accepts, Postgres accepts too', () => {
  it('a_nul_byte_in_a_product_id_is_a_400_not_a_500_and_changes_nothing', async () => {
    const body = JSON.stringify({ items: [{ productId: 'P\u0000', quantity: 1 }], orderedAt: AT });
    for (const [mod, path] of [
      [preview, '/api/v1/orders/preview'],
      [orders, '/api/v1/orders'],
    ] as const) {
      const res = await post(mod, path, body);
      const { body: envelope } = await readEnvelope(res);
      expect(res.status, path).toBe(400);
      expect((envelope.data as { errors: { field: string }[] }).errors[0]!.field).toBe(
        'items[0].productId',
      );
    }
    expect(await orderCount()).toBe(0);
  });

  it('no_request_the_schema_accepts_gives_a_server_error', async () => {
    // seeded, so a failure can be reproduced from its number
    let state = 777;
    const next = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]!;
    const ids = [
      'P001',
      'P002',
      'P003',
      'P004',
      'P005',
      'P999',
      'p001',
      'P 001',
      'P\u0000',
      'P\u0001',
      "P'; drop table stock; --",
      'P\\',
      'P%00',
      'ü',
      'P😀',
      '\ud800',
      '',
      'a'.repeat(40),
      'P-1_x',
    ];
    const statuses = new Map<number, number>();
    for (let i = 0; i < 150; i++) {
      const items = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
        productId: pick(ids),
        quantity: pick([1, 3, 50, 10000]),
      }));
      const res = await post(
        preview,
        '/api/v1/orders/preview',
        JSON.stringify({ items, orderedAt: AT }),
      );
      await readEnvelope(res);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      expect([200, 400, 422], `case ${i} ${JSON.stringify(items)}`).toContain(res.status);
    }
    expect(statuses.get(400)).toBeGreaterThan(10); // the generator reaches rejected input...
    expect((statuses.get(200) ?? 0) + (statuses.get(422) ?? 0)).toBeGreaterThan(10); // ...and accepted input
  });
});

describe('probes against the real database', () => {
  it('health_is_200', async () => {
    const res = await callRoute(health, 'GET', '/api/health');
    await readEnvelope(res);
    expect(res.status).toBe(200);
  });

  it('keep_alive_needs_the_secret_and_then_reaches_the_database', async () => {
    vi.stubEnv('CRON_SECRET', 'throwaway-secret-for-tests-only');
    const denied = await callRoute(keepAlive, 'GET', '/api/cron/keep-alive');
    await readEnvelope(denied);
    expect(denied.status).toBe(401);
    const allowed = await callRoute(keepAlive, 'GET', '/api/cron/keep-alive', {
      headers: { Authorization: 'Bearer throwaway-secret-for-tests-only' },
    });
    await readEnvelope(allowed);
    expect(allowed.status).toBe(200);
  });
});
