import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { placeOrder } from '@/db/orders';
import { clearReferenceCache } from '@/db/reference';
import { resetAll } from '@/db/reset';
import { BASELINE_STOCK } from '@/db/seed-data';
import type { OrderInput } from '@/domain/types';
import { holdRowLocks, restoreBaseline, testSql, waitUntilBlocked } from './helpers';

const sql = testSql();
afterAll(() => sql.end());
beforeEach(async () => {
  clearReferenceCache(sql);
  await restoreBaseline(sql);
});

const OFF_PEAK = '2026-10-20T13:00:00+07:00';
const order = (productId: string, quantity: number): OrderInput => ({
  items: [{ productId, quantity }],
  orderedAt: OFF_PEAK,
});
const baselineKeys = BASELINE_STOCK.map(
  (r) => `${r.warehouse_id}/${r.product_id}=${r.quantity}`,
).sort();
const stockKeys = async () =>
  (
    await sql<
      { warehouse_id: string; product_id: string; quantity: number }[]
    >`select warehouse_id, product_id, quantity from stock`
  )
    .map((r) => `${r.warehouse_id}/${r.product_id}=${r.quantity}`)
    .sort();
const orderCount = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from orders`)[0]!.n;

describe('resetAll', () => {
  it('reset_restores_the_baseline_after_orders', async () => {
    await placeOrder(sql, order('P002', 45));
    await placeOrder(sql, order('P001', 120));
    await placeOrder(sql, order('P005', 80));
    expect(await stockKeys()).not.toEqual(baselineKeys);
    await resetAll(sql);
    expect(await stockKeys()).toEqual(baselineKeys);
  });

  it('reset_deletes_all_orders', async () => {
    await placeOrder(sql, order('P001', 1));
    await placeOrder(sql, order('P001', 2));
    expect(await orderCount()).toBe(2);
    await resetAll(sql);
    expect(await orderCount()).toBe(0);
  });

  it('reset_leaves_exactly_the_baseline_rows', async () => {
    await sql`insert into stock values ('W01', 'P002', 5)`; // not in the baseline
    await resetAll(sql);
    expect(await stockKeys()).toEqual(baselineKeys);
    expect(baselineKeys).toHaveLength(23);
  });

  it('reset_creates_a_missing_baseline_row', async () => {
    await sql`delete from stock where warehouse_id = 'W04' and product_id = 'P002'`;
    await resetAll(sql);
    expect(await stockKeys()).toEqual(baselineKeys);
  });

  it('reset_is_idempotent', async () => {
    await resetAll(sql);
    await resetAll(sql);
    expect(await stockKeys()).toEqual(baselineKeys);
    expect(await orderCount()).toBe(0);
  });

  it('reset_updates_rows_in_place_so_a_waiting_order_sees_the_restored_stock', async () => {
    await sql`update stock set quantity = 0 where product_id = 'P002'`; // all Hep B gone
    const holder = await holdRowLocks(sql, ['P002']);
    let reset: Promise<void>;
    let waiting: ReturnType<typeof placeOrder>;
    try {
      reset = resetAll(sql);
      await waitUntilBlocked(sql, 1); // reset is queued first...
      waiting = placeOrder(sql, order('P002', 10));
      await waitUntilBlocked(sql, 2); // ...and the order queues behind it
    } finally {
      await holder.release();
    }
    await reset;
    const outcome = await waiting;
    // If reset had deleted and re-inserted the rows, the order would wake up to find none.
    expect(outcome.ok).toBe(true);
    const [row] = await sql<
      { total: number }[]
    >`select sum(quantity)::int as total from stock where product_id = 'P002'`;
    expect(row!.total).toBe(158 - 10);
    expect(await orderCount()).toBe(1);
  });
});
