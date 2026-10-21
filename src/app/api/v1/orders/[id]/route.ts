import { getSql } from '@/db/client';
import { getOrder } from '@/db/orders';
import { NO_STORE, ok } from '@/http/envelope';
import { NotFoundError } from '@/http/errors';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

// An id that is not a uuid is simply an order that does not exist.
export const GET = withEnvelope(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const order = await getOrder(getSql(), id);
  if (!order) throw new NotFoundError('Order not found');
  return ok(order, 'OK', { headers: NO_STORE });
});

export const { POST, PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET');
