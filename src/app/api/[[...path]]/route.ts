import { fail } from '@/http/envelope';
import { withEnvelope } from '@/http/withEnvelope';

// Any /api path without its own route file ends up here, so unknown paths get the
// envelope instead of the default HTML page. The optional catch-all also matches bare /api.
const notFound = withEnvelope(() => fail(404, 'Route not found'));

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
