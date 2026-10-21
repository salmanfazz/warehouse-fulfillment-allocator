import { expect, it } from 'vitest';

// The real DATABASE_URL lives in .env.local. A test that reaches getSql() by mistake must never
// talk to it, so the test config points DATABASE_URL at the test database (or removes it).
// The comparison is reduced to a boolean so a failure never prints a connection string.
it('the_test_process_never_holds_the_real_database_url', () => {
  const same = (process.env.DATABASE_URL ?? '') === (process.env.TEST_DATABASE_URL ?? '');
  expect(same).toBe(true);
});
