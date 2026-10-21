import postgres, { type Sql } from 'postgres';
import { DB } from '@/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// What postgres.js will really connect to. Its URL parser is not the same as `new URL`: it reads
// the part after the first "@" and accepts a comma-separated list of hosts. Anything that checks
// where a URL points must use this, not `new URL`. Throws if the URL cannot be parsed.
export function connectionTargets(url: string) {
  const parsed = postgres(url, { max: 1 }); // parsing only, it connects on first query
  const { host, port, database } = parsed.options;
  void parsed.end({ timeout: 0 });
  return { hosts: host, ports: port, database };
}

// True only if every host postgres.js would try is on this machine.
export function isLocalUrl(url: string): boolean {
  try {
    return connectionTargets(url).hosts.every((host) => LOCAL_HOSTS.has(host));
  } catch {
    return false;
  }
}

// Prepared statements are off because the Supabase pooler runs in transaction mode.
// SSL is on for any remote host; the local test database has none.
export function createSql(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    prepare: false,
    onnotice: () => {}, // Postgres NOTICE messages (such as "already exists, skipping") are not errors
    max: opts.max ?? DB.poolMax,
    connect_timeout: DB.connectTimeoutSeconds,
    ssl: isLocalUrl(url) ? false : 'require',
  });
}

// One client per server instance, kept on globalThis so dev reloads reuse it.
// Created on first use, so importing this file never connects (or fails) at build time.
const holder = globalThis as unknown as { __sql?: Sql };

export function getSql(): Sql {
  if (!holder.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    holder.__sql = createSql(url);
  }
  return holder.__sql;
}

// Ends the shared client and forgets it; a later getSql() makes a new one. For tests and shutdown.
export async function closeSql(): Promise<void> {
  const client = holder.__sql;
  holder.__sql = undefined;
  await client?.end();
}
