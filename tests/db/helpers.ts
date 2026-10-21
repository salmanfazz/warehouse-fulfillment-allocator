import type { Sql, TransactionSql } from 'postgres';
import { DB } from '@/config';
import { createSql } from '@/db/client';
import { BASELINE_STOCK } from '@/db/seed-data';
import { assertSafeTestDatabase } from '../support/test-db';

// A client for the test database. Max 5 so concurrent work really runs concurrently.
export function testSql(): Sql {
  const url = assertSafeTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.GUARD_APP_DATABASE_URL,
  );
  return createSql(url, { max: DB.testPoolMax });
}

class Rollback extends Error {}

// Runs `fn` inside a transaction and always rolls it back, so a test leaves nothing behind.
export async function inRolledBackTx<T>(sql: Sql, fn: (tx: TransactionSql) => Promise<T>) {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result as T;
}

// The SQLSTATE code of the error a statement raises, or null if it succeeds.
export async function sqlState(statement: PromiseLike<unknown>) {
  try {
    await statement;
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

// Puts the database back to the baseline with plain SQL (not with resetAll, which is under test).
// The rows go in in reverse key order on purpose: heap order then differs from lock order, so a
// query that forgets its ORDER BY returns rows in the wrong order and a test can see it.
export async function restoreBaseline(sql: Sql) {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout = '10s'");
    await tx`delete from orders`;
    await tx`delete from stock`;
    await tx`insert into stock ${tx([...BASELINE_STOCK].reverse())}`;
  });
}

// Locks the stock rows of the given products from a separate transaction, so a test can start
// competing operations that all have to wait. Always call release(), in a finally block.
export async function holdRowLocks(sql: Sql, productIds: string[]) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let locked!: () => void;
  const hasLocks = new Promise<void>((resolve) => (locked = resolve));
  const holder = sql.begin(async (tx) => {
    await tx`
      select 1 from stock where product_id = any(${productIds})
      order by warehouse_id, product_id for update`;
    locked();
    await gate;
  });
  await Promise.race([hasLocks, holder]);
  return {
    release: async () => {
      open();
      await holder;
    },
  };
}

// Waits until at least `count` sessions are blocked on a lock, or fails after the timeout.
export async function waitUntilBlocked(sql: Sql, count: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) >= count) return;
    if (Date.now() > deadline)
      throw new Error(`Fewer than ${count} sessions became blocked within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
