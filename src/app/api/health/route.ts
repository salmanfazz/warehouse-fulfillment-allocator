import { getSql } from '@/db/client';
import { ok } from '@/http/envelope';
import { ServiceUnavailableError } from '@/http/errors';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

export const GET = withEnvelope(async () => {
  try {
    await getSql()`select 1`;
  } catch (err) {
    throw new ServiceUnavailableError(err);
  }
  return ok({ status: 'ok' }, 'Database reachable', { headers: { 'Cache-Control': 'no-store' } });
});

export const { POST, PUT, PATCH, DELETE } = notAllowed('GET');
