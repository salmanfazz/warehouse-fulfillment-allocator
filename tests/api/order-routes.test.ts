import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as orders from '@/app/api/v1/orders/route';
import * as preview from '@/app/api/v1/orders/preview/route';
import * as reset from '@/app/api/v1/reset/route';
import { getSql } from '@/db/client';
import { listOrders, placeOrder, previewOrder } from '@/db/orders';
import { resetAll } from '@/db/reset';
import type { Failure } from '@/domain/types';
import { callRoute, readEnvelope } from './helpers';

vi.mock('@/db/client', () => ({ getSql: vi.fn() }));
vi.mock('@/db/reset', () => ({ resetAll: vi.fn() }));
vi.mock('@/db/orders', () => ({
  getOrder: vi.fn(),
  listOrders: vi.fn(),
  placeOrder: vi.fn(),
  previewOrder: vi.fn(),
}));

const CLIENT = { name: 'the shared client' };
const ORDER_ID = '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e';
const PLAN = {
  orderedAt: '2026-10-20T13:00:00+07:00',
  shipments: [],
  totalMinutes: 68,
  totalCost: 665,
  reasons: [],
  alternatives: [],
};
const BODY = JSON.stringify({
  items: [{ productId: 'P002', quantity: 45 }],
  orderedAt: '2026-10-20T13:00:00+07:00',
});
const FAILURES: Failure[] = [
  {
    reason: 'UNKNOWN_PRODUCT',
    info: 'Unknown product: P999',
    shortfalls: [{ productId: 'P999', requested: 2, available: 0 }],
  },
  {
    reason: 'INSUFFICIENT_STOCK',
    info: 'Not enough stock for Surgical Gloves (Box of 100): requested 5000, available 1100',
    shortfalls: [{ productId: 'P001', requested: 5000, available: 1100 }],
  },
  {
    reason: 'COLD_CHAIN_UNAVAILABLE',
    info: 'Only 108 of 158 units of Vaccine - Hepatitis B (10-dose vial) can be shipped with cold chain',
    shortfalls: [{ productId: 'P002', requested: 120, available: 108 }],
  },
];

const post = (mod: object, path: string, body: string, headers: Record<string, string> = {}) =>
  callRoute(mod, 'POST', path, { body, headers });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSql).mockReturnValue(CLIENT as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/v1/orders/preview', () => {
  it('preview_ok_is_200_with_the_plan_and_no_order_id', async () => {
    vi.mocked(previewOrder).mockResolvedValue({ ok: true, plan: PLAN } as never);
    const res = await post(preview, '/api/v1/orders/preview', BODY);
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual(PLAN);
    expect(Object.keys(body.data as object)).not.toContain('orderId');
    expect(res.headers.get('location')).toBeNull();
    expect(previewOrder).toHaveBeenCalledWith(CLIENT, JSON.parse(BODY));
  });

  it('preview_shortfall_is_422_with_info_reason_and_shortfalls', async () => {
    for (const failure of FAILURES) {
      vi.mocked(previewOrder).mockResolvedValue({ ok: false, failure } as never);
      const res = await post(preview, '/api/v1/orders/preview', BODY);
      const { body } = await readEnvelope(res);
      expect(res.status, failure.reason).toBe(422);
      expect(body.info).toBe(failure.info);
      expect(body.data).toEqual({ reason: failure.reason, shortfalls: failure.shortfalls });
    }
  });

  it('get_on_preview_is_405_allow_post_not_an_order_lookup', async () => {
    const res = await callRoute(preview, 'GET', '/api/v1/orders/preview');
    await readEnvelope(res);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});

describe('POST /api/v1/orders', () => {
  it('place_ok_is_201_with_location_equal_to_the_order_id', async () => {
    const order = { orderId: ORDER_ID, ...PLAN };
    vi.mocked(placeOrder).mockResolvedValue({ ok: true, order } as never);
    const res = await post(orders, '/api/v1/orders', BODY);
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/api/v1/orders/${ORDER_ID}`);
    expect((body.data as { orderId: string }).orderId).toBe(ORDER_ID);
    expect(body.info).toBe('Order placed');
    expect(placeOrder).toHaveBeenCalledWith(CLIENT, JSON.parse(BODY));
  });

  it('place_shortfall_is_422_and_has_no_location', async () => {
    for (const failure of FAILURES) {
      vi.mocked(placeOrder).mockResolvedValue({ ok: false, failure } as never);
      const res = await post(orders, '/api/v1/orders', BODY);
      const { body } = await readEnvelope(res);
      expect(res.status, failure.reason).toBe(422);
      expect(res.headers.get('location')).toBeNull();
      expect(body.info).toBe(failure.info);
      expect(body.data).toEqual({ reason: failure.reason, shortfalls: failure.shortfalls });
    }
  });

  it('place_unknown_product_is_422_not_400', async () => {
    vi.mocked(placeOrder).mockResolvedValue({ ok: false, failure: FAILURES[0]! } as never);
    const res = await post(
      orders,
      '/api/v1/orders',
      JSON.stringify({ items: [{ productId: 'P999', quantity: 2 }] }),
    );
    expect(res.status).toBe(422);
    await readEnvelope(res);
  });

  it('content_type_header_is_ignored', async () => {
    vi.mocked(placeOrder).mockResolvedValue({
      ok: true,
      order: { orderId: ORDER_ID, ...PLAN },
    } as never);
    const variants: Record<string, string>[] = [
      {},
      { 'Content-Type': 'text/plain' },
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    ];
    for (const headers of variants) {
      expect((await post(orders, '/api/v1/orders', BODY, headers)).status).toBe(201);
    }
  });

  it('missing_ordered_at_is_filled_with_now', async () => {
    vi.mocked(placeOrder).mockResolvedValue({
      ok: true,
      order: { orderId: ORDER_ID, ...PLAN },
    } as never);
    const before = Date.now();
    await post(
      orders,
      '/api/v1/orders',
      JSON.stringify({ items: [{ productId: 'P001', quantity: 1 }] }),
    );
    const input = vi.mocked(placeOrder).mock.calls[0]![1];
    const at = Date.parse(input.orderedAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('invalid requests', () => {
  const bad: [string, string][] = [
    ['empty items', JSON.stringify({ items: [] })],
    [
      'six items',
      JSON.stringify({
        items: Array.from({ length: 6 }, (_, i) => ({ productId: `P00${i}`, quantity: 1 })),
      }),
    ],
    [
      'repeated product',
      JSON.stringify({
        items: [
          { productId: 'P001', quantity: 1 },
          { productId: 'P001', quantity: 2 },
        ],
      }),
    ],
    ['fractional quantity', JSON.stringify({ items: [{ productId: 'P001', quantity: 1.5 }] })],
    ['text quantity', JSON.stringify({ items: [{ productId: 'P001', quantity: '10' }] })],
    [
      'bad time',
      JSON.stringify({
        items: [{ productId: 'P001', quantity: 1 }],
        orderedAt: '2026-02-30T00:00:00Z',
      }),
    ],
    [
      'typo in a field name',
      JSON.stringify({
        items: [{ productId: 'P001', quantity: 1 }],
        orderAt: '2026-10-20T13:00:00+07:00',
      }),
    ],
    ['invalid json', '{"items": ['],
    ['empty body', ''],
    ['an array', '[]'],
  ];

  for (const route of [
    { name: 'preview', mod: preview, path: '/api/v1/orders/preview', fn: previewOrder },
    { name: 'place', mod: orders, path: '/api/v1/orders', fn: placeOrder },
  ]) {
    it(`${route.name}: invalid_body_is_400_with_field_errors_and_never_calls_the_database`, async () => {
      for (const [label, body] of bad) {
        const res = await post(route.mod, route.path, body);
        const { body: envelope } = await readEnvelope(res);
        expect(res.status, label).toBe(400);
        expect(envelope.info, label).toBe('Invalid request');
        const data = envelope.data as {
          reason: string;
          errors: { field: string; message: string }[];
        };
        expect(data.reason, label).toBe('VALIDATION_ERROR');
        expect(data.errors.length, label).toBeGreaterThan(0);
        expect(
          data.errors.every((e) => e.field && e.message),
          label,
        ).toBe(true);
      }
      expect(route.fn).not.toHaveBeenCalled();
      expect(getSql).not.toHaveBeenCalled();
    });
  }
});

describe('GET /api/v1/orders', () => {
  it('list_orders_200_named_key_no_store', async () => {
    const summary = {
      orderId: ORDER_ID,
      createdAt: '2026-10-21T10:00:00+07:00',
      orderedAt: PLAN.orderedAt,
      items: [],
      warehouseIds: ['W04'],
      totalMinutes: 49,
      totalCost: 280,
    };
    vi.mocked(listOrders).mockResolvedValue([summary]);
    const res = await callRoute(orders, 'GET', '/api/v1/orders');
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ orders: [summary] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(listOrders).toHaveBeenCalledWith(CLIENT);
  });
});

describe('POST /api/v1/reset', () => {
  it('reset_200_data_null_and_info', async () => {
    vi.mocked(resetAll).mockResolvedValue(undefined);
    const res = await callRoute(reset, 'POST', '/api/v1/reset');
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ info: 'Demo data reset to baseline', data: null });
    expect(resetAll).toHaveBeenCalledWith(CLIENT);
  });

  it('get_on_reset_is_405_allow_post_and_nothing_is_reset', async () => {
    const res = await callRoute(reset, 'GET', '/api/v1/reset');
    await readEnvelope(res);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(resetAll).not.toHaveBeenCalled();
  });
});

describe('methods on the order routes', () => {
  it('put_patch_delete_are_405_on_orders_with_allow_get_post_and_options_matches', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await callRoute(orders, method, '/api/v1/orders');
      await readEnvelope(res);
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('GET, POST');
    }
    const options = await callRoute(orders, 'OPTIONS', '/api/v1/orders');
    await readEnvelope(options);
    expect(options.status).toBe(200);
    expect(options.headers.get('allow')).toBe('GET, POST');
  });

  it('options_on_preview_and_reset_say_post', async () => {
    for (const [mod, path] of [
      [preview, '/api/v1/orders/preview'],
      [reset, '/api/v1/reset'],
    ] as const) {
      const res = await callRoute(mod, 'OPTIONS', path);
      await readEnvelope(res);
      expect(res.status).toBe(200);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
});

describe('failures behind the routes', () => {
  const down = Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:6543'), {
    code: 'ECONNREFUSED',
  });
  const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), {
    code: '55P03',
  });
  const calls: [string, () => Promise<Response>][] = [
    ['preview', () => post(preview, '/api/v1/orders/preview', BODY)],
    ['place', () => post(orders, '/api/v1/orders', BODY)],
    ['list', () => callRoute(orders, 'GET', '/api/v1/orders')],
    ['reset', () => callRoute(reset, 'POST', '/api/v1/reset')],
  ];
  const failWith = (error: Error) => {
    vi.mocked(previewOrder).mockRejectedValue(error);
    vi.mocked(placeOrder).mockRejectedValue(error);
    vi.mocked(listOrders).mockRejectedValue(error);
    vi.mocked(resetAll).mockRejectedValue(error);
  };

  it('database_down_and_lock_timeouts_are_503_and_generic', async () => {
    for (const error of [down, lockTimeout]) {
      failWith(error);
      for (const [name, call] of calls) {
        const res = await call();
        const { text } = await readEnvelope(res);
        expect(res.status, `${name} ${(error as { code: string }).code}`).toBe(503);
        expect(text.includes('10.9.8.7') || text.includes('lock timeout')).toBe(false);
      }
    }
  });

  it('unexpected_errors_including_a_domain_range_error_are_a_generic_500', async () => {
    for (const error of [
      new Error('password=hunter2'),
      new RangeError('Quantities must be whole numbers of at least 1'),
    ]) {
      failWith(error);
      for (const [name, call] of calls) {
        const res = await call();
        const { text } = await readEnvelope(res);
        expect(res.status, name).toBe(500);
        expect(text.includes('hunter2') || text.includes('Quantities must')).toBe(false);
      }
    }
  });
});
