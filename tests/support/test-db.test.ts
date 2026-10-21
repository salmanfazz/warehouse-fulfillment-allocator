import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from './test-db';

const APP = 'postgres://postgres.abc:apppw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const LOCAL = 'postgres://postgres:secretpw@127.0.0.1:5433/postgres';

function message(testUrl: string | undefined, appUrl: string | undefined = APP) {
  try {
    assertSafeTestDatabase(testUrl, appUrl);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected assertSafeTestDatabase to throw');
}

describe('assertSafeTestDatabase', () => {
  it('throws_when_unset_and_says_how_to_start_the_container', () => {
    expect(message(undefined)).toMatch(/TEST_DATABASE_URL is not set/);
    expect(message('')).toMatch(/docker start allocator-test-pg/);
  });

  it('throws_when_the_url_is_not_a_url', () => {
    expect(message('not a url')).toMatch(/not a valid URL/);
  });

  it('throws_when_host_is_not_local', () => {
    expect(message('postgres://u:secretpw@db.example.com:5432/x')).toMatch(
      /localhost or 127\.0\.0\.1/,
    );
  });

  it('throws_on_lookalike_hosts', () => {
    expect(message('postgres://u:secretpw@127.0.0.1.evil.com:5432/x')).toMatch(/evil\.com/);
    expect(message('postgres://u:secretpw@evil.com/localhost')).toMatch(/evil\.com/);
    expect(message('postgres://127.0.0.1:secretpw@evil.com:5432/x')).toMatch(/evil\.com/);
  });

  it('throws_when_it_is_the_same_database_as_the_app', () => {
    const app = 'postgres://postgres:apppw@localhost:5433/postgres';
    expect(message(LOCAL, app)).toMatch(/same database/);
  });

  it('accepts_a_different_local_database_on_the_same_machine', () => {
    const app = 'postgres://postgres:apppw@localhost:5433/other';
    expect(assertSafeTestDatabase(LOCAL, app)).toBe(LOCAL);
  });

  it('accepts_localhost_and_127_0_0_1_when_the_app_url_is_remote_or_missing', () => {
    expect(assertSafeTestDatabase(LOCAL, APP)).toBe(LOCAL);
    expect(assertSafeTestDatabase(LOCAL, undefined)).toBe(LOCAL);
    const viaName = 'postgres://postgres:pw@localhost:5433/postgres';
    expect(assertSafeTestDatabase(viaName, APP)).toBe(viaName);
  });

  it('error_messages_never_contain_the_password', () => {
    const bad = [
      'postgres://u:secretpw@db.example.com:5432/x',
      'postgres://u:secretpw@127.0.0.1.evil.com:5432/x',
      'postgres://postgres:secretpw@localhost:5433/postgres',
    ];
    for (const url of bad) {
      const app = 'postgres://postgres:apppw@127.0.0.1:5433/postgres';
      expect(message(url, app)).not.toContain('secretpw');
    }
  });

  // postgres.js reads the part after the FIRST "@" and treats commas as a list of hosts,
  // while `new URL` reads after the LAST "@". The guard must judge what postgres.js will use.
  it('throws_on_a_multi_host_url_whose_first_host_is_remote', () => {
    const sneaky = 'postgres://u:secretpw@attacker.invalid,x@localhost:5433/db';
    expect(message(sneaky)).toMatch(/localhost or 127\.0\.0\.1/);
    expect(message(sneaky)).not.toContain('secretpw');
  });

  it('throws_when_any_host_in_a_list_is_remote', () => {
    expect(message('postgres://u:p@localhost:5433,db.example.com:5432/db')).toMatch(/example\.com/);
  });

  it('never_prints_an_odd_looking_host_that_could_hold_a_password', () => {
    expect(message('postgres://u:p@evil.invalid,secretpw@localhost/db')).not.toContain('secretpw');
  });

  it('treats_a_host_list_that_includes_the_app_database_as_the_same_database', () => {
    const app = 'postgres://postgres:apppw@127.0.0.1:5433/postgres';
    expect(message('postgres://u:p@localhost:5433,127.0.0.1:5434/postgres', app)).toMatch(
      /same database/,
    );
  });
});
