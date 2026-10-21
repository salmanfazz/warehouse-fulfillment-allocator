import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from 'postgres';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

// Applies db/migrations/*.sql in file-name order, each file in its own transaction together
// with its schema_migrations row, so a failed file leaves nothing behind. Returns the files
// applied in this run. No checksums, no down migrations, no lock between concurrent runners.
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  // The tracking table is also in `public`, so it is locked down like the others.
  await sql
    .unsafe(
      `create table if not exists schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       );
       alter table schema_migrations enable row level security;
       revoke all on schema_migrations from anon, authenticated;`,
    )
    .simple();

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const rows = await sql<{ filename: string }[]>`select filename from schema_migrations`;
  const done = new Set(rows.map((r) => r.filename));

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const contents = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(contents).simple();
      await tx`insert into schema_migrations (filename) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
