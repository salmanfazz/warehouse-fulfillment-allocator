import { expect, it } from 'vitest';

// The real DATABASE_URL lives in .env.local. A test that reaches getSql() by mistake must never
// talk to it, so the test config points DATABASE_URL at the test database (or removes it).
// The comparison is reduced to a boolean so a failure never prints a connection string.
it('the_test_process_never_holds_the_real_database_url', () => {
  const same = (process.env.DATABASE_URL ?? '') === (process.env.TEST_DATABASE_URL ?? '');
  expect(same).toBe(true);
});

// Same idea for the other secrets in .env.local: a test that forgot to stub one must not be
// able to use (or print) the real value.
it('the_test_process_holds_no_real_cron_secret_or_oidc_token', () => {
  expect(process.env.CRON_SECRET === undefined).toBe(true);
  expect(process.env.VERCEL_OIDC_TOKEN === undefined).toBe(true);
});
