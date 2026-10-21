import type { Sql, TransactionSql } from 'postgres';
import { createSql } from '@/db/client';
import { assertSafeTestDatabase } from '../support/test-db';

// A client for the test database. Max 5 so concurrent work really runs concurrently.
export function testSql(): Sql {
  const url = assertSafeTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.GUARD_APP_DATABASE_URL,
  );
  return createSql(url, { max: 5 });
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
