import { describe, expect, it } from 'vitest';
import { createSql, isLocalUrl } from '@/db/client';

describe('isLocalUrl', () => {
  it('is_true_only_for_localhost_and_127_0_0_1', () => {
    expect(isLocalUrl('postgres://u:p@localhost:5433/db')).toBe(true);
    expect(isLocalUrl('postgres://u:p@127.0.0.1:5433/db')).toBe(true);
    expect(isLocalUrl('postgres://u:p@db.example.com:6543/db')).toBe(false);
    expect(isLocalUrl('postgres://u:p@127.0.0.1.evil.com:5433/db')).toBe(false);
  });

  it('is_false_for_a_host_list_with_any_remote_host', () => {
    expect(isLocalUrl('postgres://u:p@attacker.invalid,x@localhost:5433/db')).toBe(false);
    expect(isLocalUrl('postgres://u:p@localhost:5433,db.example.com:5432/db')).toBe(false);
  });
});

describe('createSql', () => {
  it('turns_ssl_off_for_a_local_url_and_on_for_a_remote_one', async () => {
    const local = createSql('postgres://u:p@localhost:5433/db');
    const remote = createSql('postgres://u:p@db.example.com:6543/db');
    const sneaky = createSql('postgres://u:p@attacker.invalid,x@localhost:5433/db');
    try {
      expect(local.options.ssl).toBe(false);
      expect(remote.options.ssl).toBeTruthy();
      expect(sneaky.options.ssl).toBeTruthy();
    } finally {
      await Promise.all([local.end(), remote.end(), sneaky.end()]);
    }
  });
});
