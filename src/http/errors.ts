import type { Failure } from '@/domain/types';

export type FieldError = { field: string; message: string };
// Thrown by handlers; withEnvelope turns it into the matching enveloped response.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly info: string,
    readonly data: unknown = null,
    cause?: unknown,
  ) {
    super(info, { cause });
  }
}

export class ValidationError extends ApiError {
  constructor(errors: FieldError[]) {
    super(400, 'Invalid request', { reason: 'VALIDATION_ERROR', errors });
  }
}

// A well-formed order that cannot be fulfilled (unknown product, not enough stock, stock that
// cannot be shipped cold). The domain has already worded it; this only carries it to a 422.
export class RejectedOrderError extends ApiError {
  constructor(failure: Failure) {
    super(422, failure.info, { reason: failure.reason, shortfalls: failure.shortfalls });
  }
}

export class NotFoundError extends ApiError {
  constructor(info = 'Not found') {
    super(404, info);
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, 'Unauthorized');
  }
}

// The database could not answer. The cause is logged with the guid, never sent to the client.
export class ServiceUnavailableError extends ApiError {
  constructor(cause: unknown) {
    super(503, 'Database unavailable', null, cause);
  }
}
