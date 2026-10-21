import { afterAll, describe, expect, it } from 'vitest';
import { assertLooksThrowaway } from '../support/test-db';
import { inRolledBackTx, testSql } from './helpers';

const sql = testSql();
afterAll(() => sql.end());

describe('assertLooksThrowaway', () => {
  it('looks_throwaway_passes_on_the_test_database', async () => {
    await expect(assertLooksThrowaway(sql)).resolves.toBeUndefined();
  });

  it('refuses_a_database_with_an_auth_schema', async () => {
    await inRolledBackTx(sql, async (tx) => {
      await tx.unsafe('create schema auth');
      await expect(assertLooksThrowaway(tx as unknown as typeof sql)).rejects.toThrow(
        /real Supabase/,
      );
    });
  });

  it('refuses_a_database_with_a_supabase_admin_role', async () => {
    await inRolledBackTx(sql, async (tx) => {
      await tx.unsafe('create role supabase_admin nologin');
      await expect(assertLooksThrowaway(tx as unknown as typeof sql)).rejects.toThrow(
        /real Supabase/,
      );
    });
  });
});
