import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getOrder, placeOrder, previewOrder, type PlaceOutcome } from '@/db/orders';
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
const order = (...items: [string, number][]): OrderInput => ({
  items: items.map(([productId, quantity]) => ({ productId, quantity })),
  orderedAt: OFF_PEAK,
});
const hepB = (quantity: number) => order(['P002', quantity]);

const orderCount = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from orders`)[0]!.n;
const minQuantity = async () =>
  (await sql<{ m: number }[]>`select min(quantity)::int as m from stock`)[0]!.m;
const hepBTotals = async () => {
  const [row] = await sql<{ network: number; shippable: number }[]>`
    select sum(s.quantity)::int as network,
           coalesce(sum(s.quantity) filter (where w.has_cold_storage and w.has_refrigerated_vehicle), 0)::int as shippable
    from stock s join warehouses w on w.id = s.warehouse_id where s.product_id = 'P002'`;
  return row!;
};
function split(results: PlaceOutcome[]) {
  return {
    ok: results.filter((r) => r.ok),
    failed: results.filter((r): r is Extract<PlaceOutcome, { ok: false }> => !r.ok),
  };
}
// Leaves exactly `vials` Hep B vials in warehouses that can ship them (W04); W02 and W06 still hold 50 that cannot be shipped.
const leaveHepB = (vials: number) =>
  sql`update stock set quantity = case when warehouse_id = 'W04' then ${vials}::int else 0 end
      where product_id = 'P002' and warehouse_id in ('W04', 'W07', 'W08')`;

describe('the last vials', () => {
  it('two_simultaneous_orders_for_the_last_vials_give_one_success_and_one_422', async () => {
    await leaveHepB(10);
    const holder = await holdRowLocks(sql, ['P002']);
    let first: Promise<PlaceOutcome>;
    let second: Promise<PlaceOutcome>;
    try {
      first = placeOrder(sql, hepB(10));
      await waitUntilBlocked(sql, 1);
      second = placeOrder(sql, hepB(10));
      await waitUntilBlocked(sql, 2); // both are waiting for the same rows
    } finally {
      await holder.release();
    }
    const { ok, failed } = split([await first, await second]);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.failure.reason).toBe('COLD_CHAIN_UNAVAILABLE'); // W02 and W06 still hold 50 that cannot ship cold
    expect(failed[0]!.failure.shortfalls).toEqual([
      { productId: 'P002', requested: 10, available: 0 },
    ]);
    expect(await hepBTotals()).toEqual({ network: 50, shippable: 0 });
    expect(await minQuantity()).toBeGreaterThanOrEqual(0);
    expect(await orderCount()).toBe(1);
  });

  it('the_same_race_without_held_locks_over_ten_rounds', async () => {
    for (let round = 0; round < 10; round++) {
      await restoreBaseline(sql);
      await leaveHepB(10);
      const { ok, failed } = split(
        await Promise.all([placeOrder(sql, hepB(10)), placeOrder(sql, hepB(10))]),
      );
      expect([ok.length, failed.length], `round ${round}`).toEqual([1, 1]);
      expect((await hepBTotals()).shippable, `round ${round}`).toBe(0);
      expect(await minQuantity(), `round ${round}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('two_orders_that_both_fit_are_both_applied_without_lost_updates', async () => {
    const { ok } = split(await Promise.all([placeOrder(sql, hepB(45)), placeOrder(sql, hepB(45))]));
    expect(ok).toHaveLength(2);
    expect(await hepBTotals()).toEqual({ network: 158 - 90, shippable: 108 - 90 });
    expect(await orderCount()).toBe(2);
  });

  it('thirty_orders_of_five_never_oversell_108_shippable_vials', async () => {
    const { ok, failed } = split(
      await Promise.all(Array.from({ length: 30 }, () => placeOrder(sql, hepB(5)))),
    );
    expect(ok).toHaveLength(21); // 21 x 5 = 105 <= 108 < 110
    expect(failed).toHaveLength(9);
    expect(new Set(failed.map((f) => f.failure.reason))).toEqual(
      new Set(['COLD_CHAIN_UNAVAILABLE']),
    );
    expect(await hepBTotals()).toEqual({ network: 158 - 105, shippable: 3 });
    expect(await minQuantity()).toBeGreaterThanOrEqual(0);
    expect(await orderCount()).toBe(21);
  });
});

describe('deadlocks', () => {
  it('no_deadlock_across_mixed_operations', async () => {
    const operations: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i++) {
      const kind = i % 8;
      if (kind === 0) operations.push(placeOrder(sql, order(['P001', 1], ['P002', 1])));
      else if (kind === 1)
        operations.push(placeOrder(sql, order(['P002', 1], ['P001', 1]))); // same rows, other request order
      else if (kind === 2) operations.push(placeOrder(sql, order(['P003', 2], ['P005', 2])));
      else if (kind === 3)
        operations.push(placeOrder(sql, order(['P005', 1], ['P004', 1], ['P001', 1])));
      else if (kind === 4) operations.push(previewOrder(sql, order(['P001', 3], ['P002', 3])));
      else if (kind === 5) operations.push(placeOrder(sql, order(['P004', 1], ['P002', 1])));
      else if (kind === 6 && i % 16 === 6) operations.push(resetAll(sql));
      else operations.push(placeOrder(sql, order(['P003', 1])));
    }
    const settled = await Promise.allSettled(operations);
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.map((r) => (r.reason as { code?: string }).code ?? String(r.reason))).toEqual(
      [],
    );
    expect(await minQuantity()).toBeGreaterThanOrEqual(0);
  });
});

describe('reset while orders run', () => {
  // After everything settles, every stock row must equal baseline minus what the surviving orders shipped.
  async function expectConsistent(label: string) {
    const baseline = new Map(
      BASELINE_STOCK.map((r) => [`${r.warehouse_id}/${r.product_id}`, r.quantity]),
    );
    const shipped = new Map<string, number>();
    for (const row of await sql`select id from orders`) {
      const plan = await getOrder(sql, row.id as string);
      for (const s of plan!.shipments) {
        for (const item of s.items) {
          const key = `${s.warehouseId}/${item.productId}`;
          shipped.set(key, (shipped.get(key) ?? 0) + item.quantity);
        }
      }
    }
    const rows = await sql<
      { warehouse_id: string; product_id: string; quantity: number }[]
    >`select * from stock`;
    expect(rows, label).toHaveLength(baseline.size);
    for (const r of rows) {
      const key = `${r.warehouse_id}/${r.product_id}`;
      expect(r.quantity, `${label} ${key}`).toBe(baseline.get(key)! - (shipped.get(key) ?? 0));
      expect(r.quantity, `${label} ${key}`).toBeGreaterThanOrEqual(0);
    }
  }

  it('reset_while_orders_are_running_keeps_stock_and_stored_orders_consistent', async () => {
    for (let round = 0; round < 15; round++) {
      await restoreBaseline(sql);
      const work: Promise<unknown>[] = [];
      for (let i = 0; i < 8; i++) {
        const delay = (i * 7 + round * 3) % 25;
        work.push(
          new Promise((resolve) => setTimeout(resolve, delay)).then(() =>
            placeOrder(
              sql,
              i % 2 === 0 ? order(['P002', 4], ['P001', 6]) : order(['P004', 3], ['P003', 5]),
            ),
          ),
        );
        if (i === 3)
          work.push(
            new Promise((resolve) => setTimeout(resolve, round % 20)).then(() => resetAll(sql)),
          );
      }
      const settled = await Promise.allSettled(work);
      const rejected = settled.filter((r) => r.status === 'rejected');
      expect(rejected, `round ${round}`).toHaveLength(0);
      await expectConsistent(`round ${round}`);
    }
  });

  it('a_reset_after_a_burst_of_orders_restores_everything', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => placeOrder(sql, order(['P001', 7], ['P005', 3]))),
    );
    await resetAll(sql);
    expect(await orderCount()).toBe(0);
    await expectConsistent('after reset');
  });
});

describe('locks and timeouts', () => {
  it('preview_is_not_blocked_by_row_locks', async () => {
    const holder = await holdRowLocks(sql, ['P002']);
    try {
      const started = Date.now();
      const outcome = await previewOrder(sql, hepB(10));
      expect(outcome.ok).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await holder.release();
    }
  });

  it('an_order_and_a_reset_blocked_longer_than_five_seconds_fail_with_55P03_and_change_nothing', async () => {
    const holder = await holdRowLocks(sql, ['P001', 'P002']);
    let results: PromiseSettledResult<unknown>[];
    const started = Date.now();
    try {
      results = await Promise.allSettled([placeOrder(sql, order(['P001', 1])), resetAll(sql)]);
    } finally {
      await holder.release();
    }
    const elapsed = Date.now() - started;
    const codes = results.map((r) =>
      r.status === 'rejected' ? (r.reason as { code?: string }).code : 'fulfilled',
    );
    expect(codes).toEqual(['55P03', '55P03']);
    expect(elapsed).toBeGreaterThanOrEqual(4500); // the five-second lock timeout really ran
    expect(elapsed).toBeLessThan(9000);
    expect(await orderCount()).toBe(0);
    const [total] = await sql<{ n: number }[]>`select sum(quantity)::int as n from stock`;
    expect(total!.n).toBe(BASELINE_STOCK.reduce((sum, r) => sum + r.quantity, 0));
    // and nothing is left locked
    expect((await placeOrder(sql, order(['P001', 1]))).ok).toBe(true);
  }, 20_000);
});
