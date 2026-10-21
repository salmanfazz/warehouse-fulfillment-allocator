import { fail } from './envelope';
import { withEnvelope } from './withEnvelope';

// Next.js answers an unsupported method with an empty 405. This gives the enveloped version,
// with an Allow header. A route file exports only the methods it does not implement, e.g.
//   export const { POST, PUT, PATCH, DELETE } = notAllowed('GET');
export function notAllowed(...allowed: string[]) {
  const handler = withEnvelope(() =>
    fail(405, 'Method not allowed', null, { Allow: allowed.join(', ') }),
  );
  return { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler };
}
