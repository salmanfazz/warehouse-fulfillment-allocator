import { createSql } from '@/db/client';
import { migrate } from '@/db/migrate';
import { seed } from '@/db/seed';
import { assertSafeTestDatabase, ensureRoles } from '../support/test-db';

// Rebuilds the test database from nothing so every run starts the same way.
// The guard makes sure this can only ever touch a local throwaway database.
export default async function setup() {
  const url = assertSafeTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.GUARD_APP_DATABASE_URL,
  );
  const sql = createSql(url, { max: 1 });
  try {
    await sql
      .unsafe(
        'set client_min_messages = warning; drop schema public cascade; create schema public;',
      )
      .simple();
    await ensureRoles(sql);

    // Make plain Postgres behave like Supabase: the two public roles can use the schema and
    // get every privilege on new tables. Without this, the "no privileges" tests would pass
    // even if the migration had no REVOKE at all.
    await sql
      .unsafe(
        `grant usage on schema public to anon, authenticated;
         alter default privileges in schema public grant all on tables to anon, authenticated;`,
      )
      .simple();
    await sql.unsafe('create table sim_probe (id int)');
    const [probe] = await sql<{ granted: boolean }[]>`
      select has_table_privilege('anon', 'public.sim_probe', 'SELECT') as granted`;
    await sql.unsafe('drop table sim_probe');
    if (!probe?.granted) {
      throw new Error(
        'Test database does not mimic Supabase grants; privilege tests would be vacuous.',
      );
    }

    await migrate(sql);
    await seed(sql);
  } finally {
    await sql.end();
  }
}
