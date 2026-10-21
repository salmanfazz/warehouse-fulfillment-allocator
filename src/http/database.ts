import { getSql } from '@/db/client';
import { ok, type Reply } from './envelope';
import { ServiceUnavailableError } from './errors';

// "Can the database answer?" Used by /api/health and by the cron keep-alive. Any failure,
// including a missing DATABASE_URL, is a 503 whose cause is logged with the request's guid.
export async function checkDatabase(): Promise<Reply> {
  try {
    await getSql()`select 1`;
  } catch (err) {
    throw new ServiceUnavailableError(err);
  }
  return ok({ status: 'ok' }, 'Database reachable', { headers: { 'Cache-Control': 'no-store' } });
}
