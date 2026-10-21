import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listProducts, listWarehouses } from '@/db/catalog';
import { getOrder, listOrders, placeOrder } from '@/db/orders';
import { clearReferenceCache } from '@/db/reference';
import { BASELINE_STOCK } from '@/db/seed-data';
import type { OrderInput } from '@/domain/types';
import { restoreBaseline, testSql } from './helpers';

const sql = testSql();
afterAll(() => sql.end());
beforeEach(async () => {
  clearReferenceCache(sql);
  await restoreBaseline(sql);
});

const OFF_PEAK = '2026-10-20T13:00:00+07:00';
const gloves = (quantity: number): OrderInput => ({
  items: [{ productId: 'P001', quantity }],
  orderedAt: OFF_PEAK,
});
const hepB45: OrderInput = { items: [{ productId: 'P002', quantity: 45 }], orderedAt: OFF_PEAK };

async function place(input: OrderInput) {
  const outcome = await placeOrder(sql, input);
  if (!outcome.ok) throw new Error(`rejected: ${outcome.failure.reason}`);
  return outcome.order;
}

describe('getOrder', () => {
  it('get_order_returns_the_stored_plan', async () => {
    const order = await place(hepB45);
    expect(await getOrder(sql, order.orderId)).toEqual(JSON.parse(JSON.stringify(order)));
  });

  it('get_order_reads_back_exactly_what_place_order_returned_including_key_order', async () => {
    const order = await place(hepB45);
    const stored = await getOrder(sql, order.orderId);
    // jsonb keeps keys sorted by length, not in the order they were written; the read side puts them back
    expect(JSON.stringify(stored)).toBe(JSON.stringify(order));
    expect(Object.keys(stored!)).toEqual([
      'orderId',
      'orderedAt',
      'shipments',
      'totalMinutes',
      'totalCost',
      'reasons',
      'alternatives',
    ]);
    expect(Object.keys(stored!.shipments[0]!)).toEqual([
      'warehouseId',
      'city',
      'distanceKm',
      'vehicle',
      'items',
      'minutes',
      'cost',
    ]);
    expect(Object.keys(stored!.shipments[0]!.items[0]!)).toEqual(['productId', 'quantity']);
    expect(Object.keys(stored!.alternatives[0]!)).toEqual([
      'warehouseIds',
      'totalMinutes',
      'totalCost',
    ]);
  });

  it('get_order_accepts_an_upper_case_id', async () => {
    const order = await place(hepB45);
    expect((await getOrder(sql, order.orderId.toUpperCase()))?.orderId).toBe(order.orderId);
  });

  it('get_order_unknown_uuid_is_null', async () => {
    expect(await getOrder(sql, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('get_order_not_a_uuid_is_null_and_does_not_throw', async () => {
    const order = await place(hepB45);
    for (const bad of [
      '',
      'abc',
      '1; drop table orders',
      `${order.orderId} `,
      order.orderId.slice(1),
    ]) {
      expect(await getOrder(sql, bad), JSON.stringify(bad)).toBeNull();
    }
    expect((await sql`select count(*)::int as n from orders`)[0]!.n).toBe(1);
  });
});

describe('listOrders', () => {
  it('is_empty_at_first', async () => {
    expect(await listOrders(sql)).toEqual([]);
  });

  it('returns_20_newest_first_out_of_22', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 22; i++) ids.push((await place(gloves(i))).orderId);
    const list = await listOrders(sql);
    expect(list).toHaveLength(20);
    expect(list.map((o) => o.orderId)).toEqual(ids.slice(2).reverse()); // the two oldest are left out
  });

  it('summary_keys_and_item_keys_are_in_the_documented_order', async () => {
    await place(hepB45);
    const [summary] = await listOrders(sql);
    expect(Object.keys(summary!)).toEqual([
      'orderId',
      'createdAt',
      'orderedAt',
      'items',
      'warehouseIds',
      'totalMinutes',
      'totalCost',
    ]);
    expect(Object.keys(summary!.items[0]!)).toEqual(['productId', 'quantity']);
  });

  it('summary_has_exactly_the_documented_keys', async () => {
    const order = await place(hepB45);
    const [summary] = await listOrders(sql);
    expect(Object.keys(summary!).sort()).toEqual(
      [
        'createdAt',
        'items',
        'orderId',
        'orderedAt',
        'totalCost',
        'totalMinutes',
        'warehouseIds',
      ].sort(),
    );
    expect(summary).toMatchObject({
      orderId: order.orderId,
      orderedAt: '2026-10-20T13:00:00+07:00',
      items: hepB45.items,
      warehouseIds: ['W04', 'W07'],
      totalMinutes: order.totalMinutes,
      totalCost: order.totalCost,
    });
    expect(summary!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });

  it('orders_with_the_same_created_at_come_back_in_a_stable_order', async () => {
    await sql.begin(async (tx) => {
      for (const id of [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000002',
      ]) {
        await tx`insert into orders (id, ordered_at, items, plan) values (${id}, now(), '[]', ${tx.json({ orderId: id, orderedAt: OFF_PEAK, shipments: [], totalMinutes: 1, totalCost: 1 })})`;
      }
    });
    const ids = (await listOrders(sql)).map((o) => o.orderId.slice(-1));
    expect(ids).toEqual(['3', '2', '1']);
  });
});

describe('catalogue reads', () => {
  it('list_products_in_id_order', async () => {
    const products = await listProducts(sql);
    expect(products.map((p) => p.id)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
    expect(products[3]).toEqual({
      id: 'P004',
      name: 'Vaccine - Tetanus Toxoid (10-dose vial)',
      category: 'Pharmaceutical',
      requiresColdChain: true,
    });
  });

  it('list_warehouses_has_every_product_with_zero_filled_stock', async () => {
    const warehouses = await listWarehouses(sql);
    expect(warehouses.map((w) => w.id)).toEqual([
      'W01',
      'W02',
      'W03',
      'W04',
      'W05',
      'W06',
      'W07',
      'W08',
    ]);
    for (const w of warehouses)
      expect(Object.keys(w.stock)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
    expect(warehouses[0]!.stock).toEqual({ P001: 200, P002: 0, P003: 500, P004: 0, P005: 300 });
    const total = warehouses.flatMap((w) => Object.values(w.stock)).reduce((a, b) => a + b, 0);
    expect(total).toBe(BASELINE_STOCK.reduce((sum, r) => sum + r.quantity, 0));
    expect(warehouses[3]).toMatchObject({
      id: 'W04',
      city: 'Gresik',
      distanceKm: 30,
      hasColdStorage: true,
      hasRefrigeratedVehicle: true,
    });
  });

  it('list_warehouses_reflects_current_stock', async () => {
    await place(hepB45);
    const w04 = (await listWarehouses(sql)).find((w) => w.id === 'W04')!;
    expect(w04.stock.P002).toBe(0);
  });
});
