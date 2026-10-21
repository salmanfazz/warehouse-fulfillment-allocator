import { isAuthorizedCron } from '@/http/auth';
import { checkDatabase } from '@/http/database';
import { UnauthorizedError } from '@/http/errors';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

// Called daily by Vercel Cron with "Authorization: Bearer $CRON_SECRET". It only runs a trivial
// query, so the database does not pause for inactivity.
export const GET = withEnvelope(async (req) => {
  if (!isAuthorizedCron(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    throw new UnauthorizedError();
  }
  return checkDatabase();
});

export const { POST, PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET');
