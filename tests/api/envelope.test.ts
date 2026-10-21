import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type Reply } from '@/http/envelope';
import {
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  UnfulfillableError,
  UnknownProductError,
  ValidationError,
} from '@/http/errors';
import { withEnvelope } from '@/http/withEnvelope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Envelope = { guid: string; code: number; info: string; data: unknown };

async function run(handler: () => Reply | Promise<Reply>) {
  const res = await withEnvelope(handler)(new Request('http://localhost/api/x'), undefined);
  const body = (await res.json()) as Envelope;
  return { res, body };
}

function expectEnvelope(res: Response, body: Envelope) {
  expect(Object.keys(body).sort()).toEqual(['code', 'data', 'guid', 'info']);
  expect(body.code).toBe(res.status);
  expect(body.guid).toMatch(UUID);
  expect(res.headers.get('x-request-id')).toBe(body.guid);
  expect(res.headers.get('content-type')).toContain('application/json');
}

afterEach(() => vi.restoreAllMocks());

describe('envelope', () => {
  it('ok_sets_200_and_exact_four_keys', async () => {
    const { res, body } = await run(() => ok({ hello: 'world' }));
    expect(res.status).toBe(200);
    expectEnvelope(res, body);
    expect(body.info).toBe('OK');
    expect(body.data).toEqual({ hello: 'world' });
  });

  it('ok_can_return_201_with_a_location_header', async () => {
    const { res, body } = await run(() =>
      ok({ id: 1 }, 'Created', { status: 201, headers: { Location: '/api/v1/orders/1' } }),
    );
    expect(res.status).toBe(201);
    expectEnvelope(res, body);
    expect(res.headers.get('location')).toBe('/api/v1/orders/1');
  });

  it('fail_code_equals_status', async () => {
    const { res, body } = await run(() => fail(418, 'Short and stout', { a: 1 }));
    expect(res.status).toBe(418);
    expectEnvelope(res, body);
    expect(body.data).toEqual({ a: 1 });
  });

  it('every_request_gets_a_new_guid', async () => {
    const first = await run(() => ok(null));
    const second = await run(() => ok(null));
    expect(first.body.guid).not.toBe(second.body.guid);
  });

  it('validation_error_is_400_with_errors_array', async () => {
    const errors = [{ field: 'items[0].quantity', message: 'Must be a whole number' }];
    const { res, body } = await run(() => {
      throw new ValidationError(errors);
    });
    expect(res.status).toBe(400);
    expectEnvelope(res, body);
    expect(body.data).toEqual({ reason: 'VALIDATION_ERROR', errors });
  });

  it('unknown_product_is_422_with_reason_and_shortfalls', async () => {
    const shortfalls = [{ productId: 'P999', requested: 3, available: 0 }];
    const { res, body } = await run(() => {
      throw new UnknownProductError(shortfalls);
    });
    expect(res.status).toBe(422);
    expectEnvelope(res, body);
    expect(body.info).toBe('Unknown product: P999');
    expect(body.data).toEqual({ reason: 'UNKNOWN_PRODUCT', shortfalls });
  });

  it('unfulfillable_is_422_with_reason_and_shortfalls', async () => {
    const shortfalls = [{ productId: 'P002', requested: 120, available: 108 }];
    const { res, body } = await run(() => {
      throw new UnfulfillableError('COLD_CHAIN_UNAVAILABLE', 'Only 108 can be shipped', shortfalls);
    });
    expect(res.status).toBe(422);
    expectEnvelope(res, body);
    expect(body.info).toBe('Only 108 can be shipped');
    expect(body.data).toEqual({ reason: 'COLD_CHAIN_UNAVAILABLE', shortfalls });
  });

  it('not_found_is_404_data_null', async () => {
    const { res, body } = await run(() => {
      throw new NotFoundError();
    });
    expect(res.status).toBe(404);
    expectEnvelope(res, body);
    expect(body.data).toBeNull();
  });

  it('unauthorized_is_401_data_null', async () => {
    const { res, body } = await run(() => {
      throw new UnauthorizedError();
    });
    expect(res.status).toBe(401);
    expectEnvelope(res, body);
    expect(body.data).toBeNull();
  });

  it('unexpected_error_is_500_generic_info_and_message_not_in_body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await run(() => {
      throw new Error('password=hunter2');
    });
    expect(res.status).toBe(500);
    expectEnvelope(res, body);
    expect(body.data).toBeNull();
    expect(JSON.stringify(body)).not.toContain('hunter2');
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line.guid).toBe(body.guid);
    expect(line.message).toBe('password=hunter2');
    expect(typeof line.stack).toBe('string');
  });

  it('database_down_is_503_generic_and_logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await run(() => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6543'), {
        code: 'ECONNREFUSED',
      });
    });
    expect(res.status).toBe(503);
    expectEnvelope(res, body);
    expect(body.data).toBeNull();
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('a_postgres_error_that_is_not_a_connection_problem_stays_500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await run(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    expect(res.status).toBe(500);
  });

  it('service_unavailable_is_503_and_logs_the_cause_not_the_body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await run(() => {
      throw new ServiceUnavailableError(new Error('DATABASE_URL is not set'));
    });
    expect(res.status).toBe(503);
    expectEnvelope(res, body);
    expect(body.info).toBe('Database unavailable');
    expect(body.data).toBeNull();
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line.guid).toBe(body.guid);
    expect(line.message).toBe('DATABASE_URL is not set');
  });

  it('unreachable_busy_and_lock_timeout_errors_are_503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['EHOSTUNREACH', 'ENETUNREACH', '57P03', '55P03']) {
      const { res, body } = await run(() => {
        throw Object.assign(new Error(`failure ${code}`), { code });
      });
      expect(res.status, code).toBe(503);
      expectEnvelope(res, body);
      expect(body.info, code).toBe('Service temporarily unavailable');
    }
  });

  it('authentication_and_other_database_errors_stay_500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['28P01', '28000', '42P01', '23514']) {
      const { res } = await run(() => {
        throw Object.assign(new Error(`failure ${code}`), { code });
      });
      expect(res.status, code).toBe(500);
    }
  });
});
