import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clearReferenceCache } from '@/db/reference';
import { placeOrder, previewOrder, readStock } from '@/db/orders';
import { parseOrderedAt } from '@/domain/time';
import type { OrderInput } from '@/domain/types';
import { holdRowLocks, restoreBaseline, sqlState, testSql, waitUntilBlocked } from './helpers';

const sql = testSql();
afterAll(() => sql.end());
beforeEach(async () => {
  clearReferenceCache(sql);
  await restoreBaseline(sql);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OFF_PEAK = '2026-10-20T13:00:00+07:00'; // golden case G01's time
const hepB45: OrderInput = { items: [{ productId: 'P002', quantity: 45 }], orderedAt: OFF_PEAK };

const quantity = async (warehouseId: string, productId: string) => {
  const [row] = await sql<{ quantity: number }[]>`
    select quantity from stock where warehouse_id = ${warehouseId} and product_id = ${productId}`;
  return row?.quantity;
};
const allStock = () =>
  sql`select warehouse_id, product_id, quantity from stock order by warehouse_id, product_id`;
const orderCount = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from orders`)[0]!.n;

describe('previewOrder', () => {
  it('preview_changes_nothing', async () => {
    const before = await allStock();
    const outcome = await previewOrder(sql, hepB45);
    expect(outcome.ok).toBe(true);
    expect(await allStock()).toEqual(before);
    expect(await orderCount()).toBe(0);
  });

  it('preview_and_place_give_the_same_plan_on_the_same_stock', async () => {
    const preview = await previewOrder(sql, hepB45);
    const placed = await placeOrder(sql, hepB45);
    if (!preview.ok || !placed.ok) throw new Error('expected both to succeed');
    const { orderId, ...plan } = placed.order;
    expect(orderId).toMatch(UUID);
    expect(plan).toEqual(preview.plan);
  });

  it('preview_reports_a_shortfall_without_touching_anything', async () => {
    const outcome = await previewOrder(sql, {
      items: [{ productId: 'P002', quantity: 120 }],
      orderedAt: OFF_PEAK,
    });
    expect(outcome.ok).toBe(false);
    expect(await orderCount()).toBe(0);
  });
});

describe('placeOrder', () => {
  it('place_order_decrements_stock_and_returns_the_stored_plan', async () => {
    const outcome = await placeOrder(sql, hepB45);
    if (!outcome.ok) throw new Error(`rejected: ${outcome.failure.reason}`);
    const { order } = outcome;

    expect(Object.keys(order)[0]).toBe('orderId');
    expect(order.shipments.map((s) => [s.warehouseId, s.items[0]!.quantity])).toEqual([
      ['W04', 40],
      ['W07', 5],
    ]);
    expect(await quantity('W04', 'P002')).toBe(0); // 40 - 40
    expect(await quantity('W07', 'P002')).toBe(3); // 8 - 5
    expect(await quantity('W08', 'P002')).toBe(60); // untouched

    const rows = await sql`select id, ordered_at, items, plan from orders`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(order.orderId);
    expect(rows[0]!.plan).toEqual(JSON.parse(JSON.stringify(order)));
    expect(rows[0]!.items).toEqual(hepB45.items);
    expect((rows[0]!.ordered_at as Date).getTime()).toBe(parseOrderedAt(OFF_PEAK));
  });

  it('items_are_stored_as_requested_not_re_sorted', async () => {
    const items = [
      { productId: 'P002', quantity: 5 },
      { productId: 'P001', quantity: 5 },
    ];
    await placeOrder(sql, { items, orderedAt: OFF_PEAK });
    const [row] = await sql`select items from orders`;
    expect(row!.items).toEqual(items);
  });

  it('plan_is_computed_on_current_stock', async () => {
    await placeOrder(sql, hepB45);
    const second = await placeOrder(sql, hepB45);
    if (!second.ok) throw new Error('expected the second order to fit');
    const shipped = (id: string) =>
      second.order.shipments.find((s) => s.warehouseId === id)?.items[0]?.quantity ?? 0;
    expect(shipped('W04')).toBe(0); // W04 was emptied by the first order
    expect(shipped('W07')).toBeLessThanOrEqual(3); // only 3 vials left there
    expect(second.order.shipments.reduce((sum, s) => sum + s.items[0]!.quantity, 0)).toBe(45);
    expect(await orderCount()).toBe(2);
  });

  it('a_rejected_order_changes_nothing', async () => {
    const before = await allStock();
    const outcome = await placeOrder(sql, {
      items: [{ productId: 'P002', quantity: 120 }],
      orderedAt: OFF_PEAK,
    });
    expect(outcome).toMatchObject({ ok: false, failure: { reason: 'COLD_CHAIN_UNAVAILABLE' } });
    expect(await allStock()).toEqual(before);
    expect(await orderCount()).toBe(0);
  });

  it('an_unknown_product_changes_nothing', async () => {
    const before = await allStock();
    const outcome = await placeOrder(sql, {
      items: [{ productId: 'P999', quantity: 2 }],
      orderedAt: OFF_PEAK,
    });
    expect(outcome).toMatchObject({ ok: false, failure: { reason: 'UNKNOWN_PRODUCT' } });
    expect(await allStock()).toEqual(before);
    expect(await orderCount()).toBe(0);
  });

  it('several_products_are_decremented_in_the_right_places', async () => {
    const outcome = await placeOrder(sql, {
      items: [
        { productId: 'P002', quantity: 10 },
        { productId: 'P001', quantity: 100 },
      ],
      orderedAt: '2026-10-19T08:00:00+07:00', // golden case G05
    });
    expect(outcome.ok).toBe(true);
    expect(await quantity('W01', 'P001')).toBe(100); // 200 - 100
    expect(await quantity('W04', 'P002')).toBe(30); // 40 - 10
    expect(await quantity('W03', 'P001')).toBe(300); // untouched
  });

  it('a_failed_order_insert_rolls_back_the_stock_update', async () => {
    await sql
      .unsafe(
        `
      create function fail_order_insert() returns trigger language plpgsql as $$ begin raise exception 'insert refused'; end $$;
      create trigger fail_order_insert before insert on orders for each row execute function fail_order_insert();`,
      )
      .simple();
    try {
      const before = await allStock();
      await expect(placeOrder(sql, hepB45)).rejects.toThrow(/insert refused/);
      expect(await allStock()).toEqual(before); // the update was inside the same transaction
    } finally {
      await sql
        .unsafe('drop trigger fail_order_insert on orders; drop function fail_order_insert();')
        .simple();
    }
  });

  it('domain_range_errors_roll_back_and_leave_no_locks', async () => {
    const dup = {
      items: [
        { productId: 'P001', quantity: 1 },
        { productId: 'P001', quantity: 2 },
      ],
      orderedAt: OFF_PEAK,
    };
    await expect(placeOrder(sql, dup)).rejects.toThrow(RangeError);
    const next = await placeOrder(sql, {
      items: [{ productId: 'P001', quantity: 1 }],
      orderedAt: OFF_PEAK,
    });
    expect(next.ok).toBe(true); // would block (and time out) if the failed order still held its locks
  });

  it('stock_check_constraint_is_the_last_safety_net', async () => {
    const before = await allStock();
    expect(
      await sqlState(sql`update stock set quantity = quantity - 1000 where warehouse_id = 'W01'`),
    ).toBe('23514');
    expect(await allStock()).toEqual(before);
  });
});

describe('created_at', () => {
  it('created_at_is_assigned_when_the_order_is_stored_not_when_its_transaction_started', async () => {
    const holder = await holdRowLocks(sql, ['P001']);
    let waiting: ReturnType<typeof placeOrder>;
    let releasedAt: number;
    try {
      waiting = placeOrder(sql, {
        items: [{ productId: 'P001', quantity: 1 }],
        orderedAt: OFF_PEAK,
      });
      await waitUntilBlocked(sql, 1);
      await new Promise((resolve) => setTimeout(resolve, 150)); // the order has now waited a while
    } finally {
      releasedAt = Date.now();
      await holder.release();
    }
    expect((await waiting).ok).toBe(true);
    const [row] = await sql<{ created_at: Date }[]>`select created_at from orders`;
    // now() would give the moment the transaction began, before the wait
    expect(row!.created_at.getTime()).toBeGreaterThanOrEqual(releasedAt - 5);
  });
});

describe('readStock', () => {
  it('lock_rows_are_read_in_warehouse_product_order', async () => {
    // the baseline was inserted in reverse, so heap order differs from key order
    const rows = await readStock(sql, ['P003', 'P001', 'P002'], true);
    const keys = rows.map((r) => `${r.warehouseId}/${r.productId}`);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toEqual([...keys].sort());
  });

  it('only_the_ordered_products_are_read', async () => {
    const rows = await readStock(sql, ['P002'], false);
    expect(new Set(rows.map((r) => r.productId))).toEqual(new Set(['P002']));
    expect(rows).toHaveLength(5);
  });

  it('numbers_come_back_as_numbers', async () => {
    const rows = await readStock(sql, ['P001'], false);
    expect(rows.every((r) => typeof r.quantity === 'number')).toBe(true);
  });
});
