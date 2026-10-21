import { fail, ok } from './envelope';
import { withEnvelope } from './withEnvelope';

// Next.js answers an unsupported method with an empty 405. This gives the enveloped version,
// with an Allow header. A route file exports only the methods it does not implement, e.g.
//   export const { POST, PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET');
//
// It also supplies OPTIONS. Next.js would answer OPTIONS with a bare 204 whose Allow header lists
// every method the file exports, including these stubs; the enveloped reply below lists only the
// methods that really work, the same as the 405 does.
export function notAllowed(...allowed: string[]) {
  const Allow = allowed.join(', ');
  const rejected = withEnvelope(() => fail(405, 'Method not allowed', null, { Allow }));
  const options = withEnvelope(() => ok(null, 'OK', { headers: { Allow } }));
  return {
    GET: rejected,
    POST: rejected,
    PUT: rejected,
    PATCH: rejected,
    DELETE: rejected,
    OPTIONS: options,
  };
}
