import postgres, { type Sql } from 'postgres';
import { DB } from '@/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// Prepared statements are off because the Supabase pooler runs in transaction mode.
// SSL is on for any remote host; the local test database has none.
export function createSql(url: string, opts: { max?: number } = {}): Sql {
  const isLocal = LOCAL_HOSTS.has(new URL(url).hostname);
  return postgres(url, {
    prepare: false,
    onnotice: () => {}, // Postgres NOTICE messages (such as "already exists, skipping") are not errors
    max: opts.max ?? DB.poolMax,
    connect_timeout: DB.connectTimeoutSeconds,
    ssl: isLocal ? false : 'require',
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
