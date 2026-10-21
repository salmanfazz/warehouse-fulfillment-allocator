import type { Sql } from 'postgres';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Same machine, port and database name. localhost and 127.0.0.1 count as the same machine.
function identity(url: URL): string {
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return `${host}:${url.port || '5432'}${url.pathname}`;
}

// Database tests wipe tables, so they must never run against the real database.
// Messages name the host only, never the password.
export function assertSafeTestDatabase(testUrl: string | undefined, appUrl: string | undefined) {
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Database tests only run against a local Docker Postgres. ' +
        'Start it with: docker start allocator-test-pg (see docs/setup.md).',
    );
  }
  const test = parse(testUrl);
  if (!test) throw new Error('TEST_DATABASE_URL is not a valid URL.');
  if (!LOCAL_HOSTS.has(test.hostname)) {
    throw new Error(
      `TEST_DATABASE_URL must point at localhost or 127.0.0.1 (found host "${test.hostname}").`,
    );
  }
  const app = parse(appUrl);
  if (app && identity(app) === identity(test)) {
    throw new Error('TEST_DATABASE_URL points at the same database as DATABASE_URL.');
  }
  return testUrl;
}

// Plain Postgres has no anon or authenticated roles; Supabase does. Create them so the
// migration's REVOKE statements run the same way here as on Supabase.
export async function ensureRoles(sql: Sql) {
  for (const role of ['anon', 'authenticated']) {
    await sql.unsafe(
      `do $$ begin
         if not exists (select from pg_roles where rolname = '${role}') then
           create role ${role} nologin;
         end if;
       end $$`,
    );
  }
}
