export type FieldError = { field: string; message: string };
export type Shortfall = { productId: string; requested: number; available: number };

// Thrown by handlers; withEnvelope turns it into the matching enveloped response.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly info: string,
    readonly data: unknown = null,
  ) {
    super(info);
  }
}

export class ValidationError extends ApiError {
  constructor(errors: FieldError[]) {
    super(400, 'Invalid request', { reason: 'VALIDATION_ERROR', errors });
  }
}

export class UnknownProductError extends ApiError {
  constructor(shortfalls: Shortfall[]) {
    const ids = shortfalls.map((s) => s.productId).join(', ');
    super(422, `Unknown product: ${ids}`, { reason: 'UNKNOWN_PRODUCT', shortfalls });
  }
}

export class UnfulfillableError extends ApiError {
  constructor(
    reason: 'INSUFFICIENT_STOCK' | 'COLD_CHAIN_UNAVAILABLE',
    info: string,
    shortfalls: Shortfall[],
  ) {
    super(422, info, { reason, shortfalls });
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
