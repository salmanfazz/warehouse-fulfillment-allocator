import { SMOKE } from '../src/config';

// Usage: SUPABASE_PROJECT_REF=<ref> SUPABASE_ANON_KEY=<key> npm run check:data-api
// Asks Supabase's public Data API for each table with the project's public anon key. The tables
// have row level security and no privileges for anon, so every request must be refused by the
// database (error code 42501, or PGRST... for a table the API does not expose) or return nothing.
// A refusal without such a code (for example "Invalid API key" from a mistyped key, or a 404 from
// a mistyped project ref) proves nothing and fails. Prints status codes and error codes, never
// the key. Keep the key out of files and chat: read it into a shell variable
// (read -s SUPABASE_ANON_KEY; export SUPABASE_ANON_KEY).

// The tables in the public schema (db/migrations/001_schema.sql and the migration tracking table).
export const TABLES = [
  'products',
  'warehouses',
  'stock',
  'delivery_records',
  'orders',
  'schema_migrations',
] as const;

export type TableCheck = { table: string; status: number | 'error'; code?: string; ok: boolean };

const REFUSED = [401, 403, 404];
const DATABASE_REFUSAL = /^(42501|PGRST\d+)$/; // insufficient privilege, or not in the API schema

export async function checkTables(
  baseUrl: string,
  anonKey: string,
  doFetch: typeof fetch,
): Promise<TableCheck[]> {
  const results: TableCheck[] = [];
  for (const table of TABLES) {
    try {
      const res = await doFetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(SMOKE.requestTimeoutMs),
      });
      const body: unknown = await res.json().catch(() => null);
      const code =
        typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
          ? body.code
          : undefined;
      let ok = false;
      if (REFUSED.includes(res.status)) ok = code !== undefined && DATABASE_REFUSAL.test(code);
      else if (res.status === 200) ok = Array.isArray(body) && body.length === 0; // nothing readable
      results.push({ table, status: res.status, code, ok });
    } catch {
      results.push({ table, status: 'error', ok: false }); // no answer proves nothing
    }
  }
  return results;
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!ref || !key) {
    console.error(
      'Set SUPABASE_PROJECT_REF and SUPABASE_ANON_KEY (see the comment at the top of this file).',
    );
    process.exitCode = 1;
    return;
  }
  const results = await checkTables(`https://${ref}.supabase.co`, key, fetch);
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.table}: ${r.status}${r.code ? ` ${r.code}` : ''}`);
    if (!r.ok && typeof r.status === 'number' && r.status !== 200 && r.status < 500) {
      console.log('  refused, but not by the database: check the anon key and the project ref');
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0 ? 'No table is readable with the anon key.' : `${failed} table(s) failed.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('check-data-api.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
