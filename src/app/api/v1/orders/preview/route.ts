import { getSql } from '@/db/client';
import { previewOrder } from '@/db/orders';
import { ok } from '@/http/envelope';
import { RejectedOrderError } from '@/http/errors';
import { notAllowed } from '@/http/methods';
import { readOrderRequest } from '@/http/schemas';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

// Plans an order and changes nothing. This is an action, not a resource, which is why it is a
// POST under /orders and not a resource of its own.
export const POST = withEnvelope(async (req) => {
  const input = await readOrderRequest(req);
  const outcome = await previewOrder(getSql(), input);
  if (!outcome.ok) throw new RejectedOrderError(outcome.failure);
  return ok(outcome.plan, 'Order can be fulfilled; nothing was reserved');
});

export const { GET, PUT, PATCH, DELETE, OPTIONS } = notAllowed('POST');
