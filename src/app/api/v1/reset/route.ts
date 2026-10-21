import { getSql } from '@/db/client';
import { resetAll } from '@/db/reset';
import { ok } from '@/http/envelope';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

// Clears all orders and restores the baseline stock. An action, not a resource. It is public on
// purpose (the demo has no authentication), which is a known limitation.
export const POST = withEnvelope(async () => {
  await resetAll(getSql());
  return ok(null, 'Demo data reset to baseline');
});

export const { GET, PUT, PATCH, DELETE, OPTIONS } = notAllowed('POST');
