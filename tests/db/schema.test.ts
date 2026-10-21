import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '@/db/migrate';
import { inRolledBackTx, sqlState, testSql } from './helpers';

const sql = testSql();
afterAll(() => sql.end());

const TABLES = [
  'delivery_records',
  'orders',
  'products',
  'schema_migrations',
  'stock',
  'warehouses',
];
const ROLES = ['anon', 'authenticated'];
const PRIVILEGES = 'SELECT,INSERT,UPDATE,DELETE';

async function privilegeFlags(run: typeof sql, tables: string[]) {
  const flags: Record<string, boolean> = {};
  for (const table of tables) {
    for (const role of ROLES) {
      const [row] = await run<{ granted: boolean }[]>`
        select has_table_privilege(${role}, ${'public.' + table}, ${PRIVILEGES}) as granted`;
      flags[`${role}:${table}`] = row?.granted ?? true;
    }
  }
  return flags;
}

describe('schema', () => {
  it('six_tables_exist', async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by tablename`;
    expect(rows.map((r) => r.tablename)).toEqual(TABLES);
  });

  it('all_public_tables_have_rls', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
    expect(rows.map((r) => r.relname)).toEqual(TABLES);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('anon_and_authenticated_have_no_privileges_on_any_table', async () => {
    const flags = await privilegeFlags(sql, TABLES);
    expect(Object.keys(flags)).toHaveLength(TABLES.length * ROLES.length);
    expect(Object.values(flags).every((granted) => granted === false)).toBe(true);
  });

  it('a_table_created_later_gets_no_privileges_for_anon_or_authenticated', async () => {
    const flags = await inRolledBackTx(sql, async (tx) => {
      await tx.unsafe('create table tmp_probe (id int)');
      return privilegeFlags(tx as unknown as typeof sql, ['tmp_probe']);
    });
    expect(flags).toEqual({ 'anon:tmp_probe': false, 'authenticated:tmp_probe': false });
  });

  it('migrate_twice_applies_nothing_the_second_time', async () => {
    expect(await migrate(sql)).toEqual([]);
    const rows = await sql<{ filename: string }[]>`select filename from schema_migrations`;
    expect(rows.map((r) => r.filename)).toEqual(['001_schema.sql']);
  });

  it('a_broken_migration_leaves_no_table_and_no_record', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    try {
      await writeFile(
        path.join(dir, '002_bad.sql'),
        'create table half_done (id int); select * from table_that_does_not_exist;',
      );
      await expect(migrate(sql, dir)).rejects.toThrow();
      const [table] = await sql`select to_regclass('public.half_done') as t`;
      expect(table?.t).toBeNull();
      const rows = await sql`select 1 from schema_migrations where filename = '002_bad.sql'`;
      expect(rows).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('negative_stock_is_rejected', async () => {
    const code = await inRolledBackTx(sql, async (tx) => {
      await tx`insert into products values ('PX', 'x', 'x', false)`;
      await tx`insert into warehouses values ('WX', 'x', 1, false, false)`;
      return sqlState(tx`insert into stock values ('WX', 'PX', -1)`);
    });
    expect(code).toBe('23514');
  });

  it('stock_for_an_unknown_warehouse_is_rejected', async () => {
    const code = await inRolledBackTx(sql, async (tx) => {
      await tx`insert into products values ('PX', 'x', 'x', false)`;
      return sqlState(tx`insert into stock values ('WX', 'PX', 1)`);
    });
    expect(code).toBe('23503');
  });

  it('a_delivery_record_with_an_invalid_day_is_rejected', async () => {
    const code = await inRolledBackTx(sql, async (tx) => {
      await tx`insert into warehouses values ('WX', 'x', 1, false, false)`;
      return sqlState(tx`insert into delivery_records values ('DX', 'WX', 'Fun', '08:00', 30)`);
    });
    expect(code).toBe('23514');
  });
});
