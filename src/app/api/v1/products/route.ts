import { listProducts } from '@/db/catalog';
import { getSql } from '@/db/client';
import { NO_STORE, ok } from '@/http/envelope';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

export const GET = withEnvelope(async () =>
  ok({ products: await listProducts(getSql()) }, 'OK', { headers: NO_STORE }),
);

export const { POST, PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET');
