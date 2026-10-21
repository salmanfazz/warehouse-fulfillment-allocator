import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSql, getSql } from '@/db/client';

// A local URL that is never connected to: createSql only connects on the first query.
const URL_FOR_TESTS = 'postgres://u:p@127.0.0.1:5999/none';

afterEach(async () => {
  await closeSql();
  vi.unstubAllEnvs();
});

describe('closeSql', () => {
  it('close_sql_ends_the_shared_client_and_a_later_get_sql_makes_a_new_one', async () => {
    vi.stubEnv('DATABASE_URL', URL_FOR_TESTS);
    const first = getSql();
    expect(getSql()).toBe(first); // one shared client
    await closeSql();
    const second = getSql();
    expect(second).not.toBe(first);
  });

  it('close_sql_without_a_client_is_a_no_op', async () => {
    await closeSql();
    await expect(closeSql()).resolves.toBeUndefined();
  });
});
