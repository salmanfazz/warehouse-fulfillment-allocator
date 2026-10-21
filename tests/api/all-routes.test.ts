import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as catchAll from '@/app/api/[[...path]]/route';
import * as keepAlive from '@/app/api/cron/keep-alive/route';
import * as health from '@/app/api/health/route';
import * as orderById from '@/app/api/v1/orders/[id]/route';
import * as preview from '@/app/api/v1/orders/preview/route';
import * as orders from '@/app/api/v1/orders/route';
import * as products from '@/app/api/v1/products/route';
import * as reset from '@/app/api/v1/reset/route';
import * as warehouses from '@/app/api/v1/warehouses/route';
import { getSql } from '@/db/client';
import { callRoute, params, readEnvelope } from './helpers';

vi.mock('@/db/client', () => ({ getSql: vi.fn() }));

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const BODY = JSON.stringify({
  items: [{ productId: 'P001', quantity: 1 }],
  orderedAt: '2026-10-20T13:00:00+07:00',
});
const SECRET = 'throwaway-secret-for-tests-only';
const ID = '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e';

type Route = {
  probe?: boolean; // health and keep-alive: any database failure is a 503
  name: string;
  path: string;
  mod: object;
  allow: string[];
  ctx?: unknown;
  init?: Record<string, unknown>;
};
const ROUTES: Route[] = [
  { probe: true, name: 'health', path: '/api/health', mod: health, allow: ['GET'] },
  {
    probe: true,
    name: 'keep-alive',
    path: '/api/cron/keep-alive',
    mod: keepAlive,
    allow: ['GET'],
    init: { headers: { Authorization: `Bearer ${SECRET}` } },
  },
  { name: 'products', path: '/api/v1/products', mod: products, allow: ['GET'] },
  { name: 'warehouses', path: '/api/v1/warehouses', mod: warehouses, allow: ['GET'] },
  { name: 'orders', path: '/api/v1/orders', mod: orders, allow: ['GET', 'POST'] },
  { name: 'preview', path: '/api/v1/orders/preview', mod: preview, allow: ['POST'] },
  {
    name: 'order by id',
    path: `/api/v1/orders/${ID}`,
    mod: orderById,
    allow: ['GET'],
    ctx: params(ID),
  },
  { name: 'reset', path: '/api/v1/reset', mod: reset, allow: ['POST'] },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CRON_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe('every route module', () => {
  for (const route of ROUTES) {
    it(`${route.name}: exports_a_handler_for_every_method_and_is_dynamic`, () => {
      // a missing export would be answered by Next.js itself: a bare 405 or 204 without the envelope
      for (const method of ALL_METHODS) {
        expect(typeof (route.mod as Record<string, unknown>)[method], method).toBe('function');
      }
      expect((route.mod as { dynamic?: string }).dynamic).toBe('force-dynamic');
    });

    it(`${route.name}: unimplemented_methods_are_405_with_the_implemented_ones_in_allow`, async () => {
      for (const method of ALL_METHODS.filter((m) => m !== 'OPTIONS' && !route.allow.includes(m))) {
        const res = await callRoute(route.mod, method, route.path, route.init, route.ctx);
        await readEnvelope(res);
        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow'), method).toBe(route.allow.join(', '));
        expect(res.headers.get('location'), method).toBeNull();
      }
      expect(getSql).not.toHaveBeenCalled(); // a 405 never reaches the database
    });

    it(`${route.name}: options_is_an_enveloped_200_with_the_same_allow`, async () => {
      const res = await callRoute(route.mod, 'OPTIONS', route.path, {}, route.ctx);
      const { body } = await readEnvelope(res);
      expect(res.status).toBe(200);
      expect(res.headers.get('allow')).toBe(route.allow.join(', '));
      expect(body.data).toBeNull();
    });

    for (const method of route.allow) {
      it(`${route.name}: ${method} with the database failing is 503 for connection errors and a generic 500 otherwise (a probe is always 503)`, async () => {
        const init = method === 'POST' ? { ...route.init, body: BODY } : route.init;
        const cases: [Error, number][] = [
          [
            Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:6543'), {
              code: 'ECONNREFUSED',
            }),
            503,
          ],
          [
            Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
            503,
          ],
          [Object.assign(new Error('password authentication failed'), { code: '28P01' }), 500],
          [new Error('secret detail: password=hunter2'), 500],
          [new RangeError('Quantities must be whole numbers of at least 1'), 500],
        ];
        for (const [error, classified] of cases) {
          // health and keep-alive are probes: any failure to reach the database is a 503
          const status = route.probe ? 503 : classified;
          vi.mocked(getSql).mockImplementation(() => {
            throw error;
          });
          const res = await callRoute(route.mod, method, route.path, init, route.ctx);
          const { body, text } = await readEnvelope(res);
          expect(res.status, `${method} ${error.message.slice(0, 20)}`).toBe(status);
          expect(body.data).toBeNull();
          // booleans, so a failure never prints the message it is checking for
          const leaked = [error.message, '10.9.8.7', 'hunter2', 'lock timeout', SECRET].some((s) =>
            text.includes(s),
          );
          expect(leaked).toBe(false);
        }
      });
    }
  }
});

describe('the catch-all', () => {
  it('unknown_paths_under_api_are_404_for_every_method', async () => {
    const paths = [
      '/api',
      '/api/nope',
      '/api/v1',
      '/api/v1/nope',
      '/api/v1/orders/a/b/c',
      '/api/v2/orders',
      '/api/cron',
      '/api/cron/other',
    ];
    for (const path of paths) {
      for (const method of ALL_METHODS) {
        const res = await callRoute(catchAll, method, path);
        const { body } = await readEnvelope(res);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(body).toMatchObject({ info: 'Route not found', data: null });
      }
    }
  });
});
