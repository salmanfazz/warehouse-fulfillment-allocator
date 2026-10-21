import type { Sql } from 'postgres';
import { connectionTargets } from '@/db/client';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// Same machine, port and database name. localhost and 127.0.0.1 count as the same machine.
function identities(url: string): Set<string> {
  const { hosts, ports, database } = connectionTargets(url);
  return new Set(
    hosts.map((host, i) => `${host === 'localhost' ? '127.0.0.1' : host}:${ports[i]}/${database}`),
  );
}

// Only plain host names are echoed back. Anything odd could hold part of a password.
function printable(host: string): string {
  return /^[A-Za-z0-9.-]+$/.test(host) ? host : '<unusual>';
}

// Database tests wipe tables, so they must never run against the real database. Hosts are read
// the way postgres.js reads them (see connectionTargets). Messages never contain the password.
export function assertSafeTestDatabase(testUrl: string | undefined, appUrl: string | undefined) {
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Database tests only run against a local Docker Postgres. ' +
        'Start it with: docker start allocator-test-pg (see docs/setup.md).',
    );
  }
  let hosts: string[];
  try {
    hosts = connectionTargets(testUrl).hosts;
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }
  const remote = hosts.find((host) => !LOCAL_HOSTS.has(host));
  if (remote !== undefined) {
    throw new Error(
      `TEST_DATABASE_URL must point at localhost or 127.0.0.1 (found host "${printable(remote)}").`,
    );
  }
  if (appUrl) {
    let appIds: Set<string> | null = null;
    try {
      appIds = identities(appUrl);
    } catch {
      // an unparseable app URL cannot be the same database
    }
    if (appIds && [...identities(testUrl)].some((id) => appIds.has(id))) {
      throw new Error('TEST_DATABASE_URL points at the same database as DATABASE_URL.');
    }
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

// Second line of defence after the host check: the test database is rebuilt from nothing, so
// refuse one that looks like a real Supabase database (a local Supabase stack, or a tunnel to
// the real project that happens to appear on 127.0.0.1). Plain Postgres has neither.
export async function assertLooksThrowaway(sql: Sql) {
  const [row] = await sql<{ auth_schema: boolean; supabase_admin: boolean }[]>`
    select exists (select 1 from pg_namespace where nspname = 'auth') as auth_schema,
           exists (select 1 from pg_roles where rolname = 'supabase_admin') as supabase_admin`;
  if (row?.auth_schema || row?.supabase_admin) {
    throw new Error(
      'The test database has an auth schema or a supabase_admin role, so it looks like a real ' +
        'Supabase database. Tests rebuild the public schema and will not run against it.',
    );
  }
}
