import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as orderById from '@/app/api/v1/orders/[id]/route';
import * as products from '@/app/api/v1/products/route';
import * as warehouses from '@/app/api/v1/warehouses/route';
import { listProducts, listWarehouses } from '@/db/catalog';
import { getSql } from '@/db/client';
import { getOrder } from '@/db/orders';
import { callRoute, params, readEnvelope } from './helpers';

vi.mock('@/db/client', () => ({ getSql: vi.fn() }));
vi.mock('@/db/catalog', () => ({ listProducts: vi.fn(), listWarehouses: vi.fn() }));
vi.mock('@/db/orders', () => ({
  getOrder: vi.fn(),
  listOrders: vi.fn(),
  placeOrder: vi.fn(),
  previewOrder: vi.fn(),
}));

const CLIENT = { name: 'the shared client' };
const PRODUCT = {
  id: 'P001',
  name: 'Surgical Gloves (Box of 100)',
  category: 'Medical Supplies',
  requiresColdChain: false,
};
const WAREHOUSE = {
  id: 'W01',
  city: 'Surabaya',
  distanceKm: 5,
  hasColdStorage: false,
  hasRefrigeratedVehicle: false,
  stock: { P001: 200, P002: 0 },
};
const ORDER = { orderId: '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e', shipments: [] };
const UUID_ID = '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSql).mockReturnValue(CLIENT as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/v1/products', () => {
  it('products_200_with_named_key_and_no_store', async () => {
    vi.mocked(listProducts).mockResolvedValue([PRODUCT]);
    const res = await callRoute(products, 'GET', '/api/v1/products');
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ info: 'OK', data: { products: [PRODUCT] } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(listProducts).toHaveBeenCalledWith(CLIENT);
  });
});

describe('GET /api/v1/warehouses', () => {
  it('warehouses_200_with_named_key_and_stock_map', async () => {
    vi.mocked(listWarehouses).mockResolvedValue([WAREHOUSE]);
    const res = await callRoute(warehouses, 'GET', '/api/v1/warehouses');
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ warehouses: [WAREHOUSE] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(listWarehouses).toHaveBeenCalledWith(CLIENT);
  });
});

describe('GET /api/v1/orders/{id}', () => {
  const get = (id: string) =>
    callRoute(orderById, 'GET', `/api/v1/orders/${encodeURIComponent(id)}`, {}, params(id));

  it('order_by_id_200_returns_the_stored_order', async () => {
    vi.mocked(getOrder).mockResolvedValue(ORDER as never);
    const res = await get(UUID_ID);
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual(ORDER);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(getOrder).toHaveBeenCalledWith(CLIENT, UUID_ID);
  });

  it('order_unknown_is_404_order_not_found', async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    const res = await get(UUID_ID);
    const { body } = await readEnvelope(res);
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ info: 'Order not found', data: null });
  });

  it('order_id_forms_are_passed_through_and_null_is_404', async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    const ids = [
      '1; drop table orders',
      'x'.repeat(36),
      UUID_ID.slice(1),
      'a'.repeat(5000),
      '../etc/passwd',
      '%00',
      'ünïcode',
    ];
    for (const id of ids) {
      const res = await get(id);
      expect(res.status, id.slice(0, 20)).toBe(404);
      await readEnvelope(res);
      expect(getOrder).toHaveBeenLastCalledWith(CLIENT, id);
    }
  });

  it('an_upper_case_uuid_reaches_the_db_function_unchanged', async () => {
    vi.mocked(getOrder).mockResolvedValue(ORDER as never);
    expect((await get(UUID_ID.toUpperCase())).status).toBe(200);
    expect(getOrder).toHaveBeenCalledWith(CLIENT, UUID_ID.toUpperCase());
  });
});

describe('methods and failures on the read routes', () => {
  const routes = [
    { name: 'products', mod: products, path: '/api/v1/products', ctx: undefined },
    { name: 'warehouses', mod: warehouses, path: '/api/v1/warehouses', ctx: undefined },
    {
      name: 'order by id',
      mod: orderById,
      path: `/api/v1/orders/${UUID_ID}`,
      ctx: params(UUID_ID),
    },
  ];

  for (const { name, mod, path, ctx } of routes) {
    it(`${name}: other_methods_are_405_with_allow_get_and_options_is_200`, async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await callRoute(mod, method, path, {}, ctx);
        await readEnvelope(res);
        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow'), method).toBe('GET');
      }
      const options = await callRoute(mod, 'OPTIONS', path, {}, ctx);
      await readEnvelope(options);
      expect(options.status).toBe(200);
      expect(options.headers.get('allow')).toBe('GET');
    });

    it(`${name}: database_down_is_503_and_unexpected_errors_are_a_generic_500`, async () => {
      const down = Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:6543'), {
        code: 'ECONNREFUSED',
      });
      const boom = new Error('secret detail: password=hunter2');
      for (const [failure, status] of [
        [down, 503],
        [boom, 500],
      ] as const) {
        vi.mocked(listProducts).mockRejectedValue(failure);
        vi.mocked(listWarehouses).mockRejectedValue(failure);
        vi.mocked(getOrder).mockRejectedValue(failure);
        const res = await callRoute(mod, 'GET', path, {}, ctx);
        const { text } = await readEnvelope(res);
        expect(res.status).toBe(status);
        expect(text.includes('10.9.8.7') || text.includes('hunter2')).toBe(false); // booleans: a failure prints no value
      }
    });
  }
});
