import { getSql } from '@/db/client';
import { listOrders, placeOrder } from '@/db/orders';
import { NO_STORE, ok } from '@/http/envelope';
import { RejectedOrderError } from '@/http/errors';
import { notAllowed } from '@/http/methods';
import { readOrderRequest } from '@/http/schemas';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

export const GET = withEnvelope(async () =>
  ok({ orders: await listOrders(getSql()) }, 'OK', { headers: NO_STORE }),
);

// The request is validated before the database is touched. A well-formed order that cannot be
// fulfilled (unknown product, not enough stock) is a 422 carrying the domain's own message.
export const POST = withEnvelope(async (req) => {
  const input = await readOrderRequest(req);
  const outcome = await placeOrder(getSql(), input);
  if (!outcome.ok) throw new RejectedOrderError(outcome.failure);
  return ok(outcome.order, 'Order placed', {
    status: 201,
    headers: { Location: `/api/v1/orders/${outcome.order.orderId}` },
  });
});

export const { PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET', 'POST');
