import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canShip, findFailure } from '@/domain/plan';
import type { Snapshot } from '@/domain/types';
import { baselineSnapshot, itemsOf } from './helpers';

type GoldenCase = {
  name: string;
  order: Record<string, number>;
  expect: { status: number; reason?: string; shortfalls?: unknown[] };
};
const golden = JSON.parse(readFileSync('tests/fixtures/golden-cases.json', 'utf8')) as GoldenCase[];

const snapshot = baselineSnapshot();
const withWarehouse = (id: string, change: object): Snapshot => ({
  ...snapshot,
  warehouses: snapshot.warehouses.map((w) => (w.id === id ? { ...w, ...change } : w)),
});
const plain = (facts: ReturnType<typeof findFailure>) =>
  facts?.shortfalls.map(({ productId, requested, available }) => ({
    productId,
    requested,
    available,
  }));

describe('findFailure on the golden cases', () => {
  for (const c of golden.filter((g) => g.expect.status === 422)) {
    it(c.name, () => {
      const facts = findFailure(itemsOf(c.order), snapshot);
      expect(facts?.reason).toBe(c.expect.reason);
      expect(plain(facts)).toEqual(c.expect.shortfalls);
    });
  }
});

describe('findFailure', () => {
  it('facts_carry_network_and_cause', () => {
    const cold = findFailure(itemsOf({ P002: 120 }), snapshot);
    expect(cold?.shortfalls).toEqual([
      { productId: 'P002', requested: 120, available: 108, network: 158, cause: 'COLD_CHAIN' },
    ]);
    const stock = findFailure(itemsOf({ P001: 5000 }), snapshot);
    expect(stock?.shortfalls).toEqual([
      { productId: 'P001', requested: 5000, available: 1100, network: 1100, cause: 'STOCK' },
    ]);
  });

  it('mixed_shortfalls_are_insufficient_stock_in_product_id_order', () => {
    const facts = findFailure(itemsOf({ P002: 120, P001: 5000 }), snapshot);
    expect(facts?.reason).toBe('INSUFFICIENT_STOCK');
    expect(facts?.shortfalls.map((s) => [s.productId, s.cause])).toEqual([
      ['P001', 'STOCK'],
      ['P002', 'COLD_CHAIN'],
    ]);
  });

  it('two_cold_shortfalls_are_cold_chain_unavailable', () => {
    const facts = findFailure(itemsOf({ P004: 100, P002: 120 }), snapshot);
    expect(facts?.reason).toBe('COLD_CHAIN_UNAVAILABLE');
    expect(facts?.shortfalls.map((s) => s.productId)).toEqual(['P002', 'P004']);
  });

  it('cold_product_with_network_below_request_is_insufficient_stock', () => {
    const facts = findFailure(itemsOf({ P002: 200 }), snapshot); // 158 exist in total
    expect(facts?.reason).toBe('INSUFFICIENT_STOCK');
    expect(facts?.shortfalls[0]).toMatchObject({ available: 108, network: 158, cause: 'STOCK' });
  });

  it('unknown_product_is_reported_first', () => {
    const facts = findFailure(itemsOf({ P001: 5000, P999: 3 }), snapshot);
    expect(facts).toEqual({
      reason: 'UNKNOWN_PRODUCT',
      shortfalls: [{ productId: 'P999', requested: 3, available: 0, network: 0, cause: 'UNKNOWN' }],
    });
  });

  it('known_product_with_zero_stock_everywhere', () => {
    const noSyringes = { ...snapshot, stock: snapshot.stock.filter((s) => s.productId !== 'P003') };
    const facts = findFailure(itemsOf({ P003: 10 }), noSyringes);
    expect(facts?.reason).toBe('INSUFFICIENT_STOCK');
    expect(facts?.shortfalls[0]).toMatchObject({ available: 0, network: 0, cause: 'STOCK' });
  });

  it('fully_coverable_returns_null', () => {
    expect(findFailure(itemsOf({ P001: 250, P005: 10 }), snapshot)).toBeNull();
  });

  it('order_exactly_equal_to_shippable_is_coverable', () => {
    expect(findFailure(itemsOf({ P002: 108 }), snapshot)).toBeNull();
    expect(findFailure(itemsOf({ P002: 109 }), snapshot)).not.toBeNull();
  });

  it('cold_flags_decide_not_ids', () => {
    // W02 gets a refrigerated van: its 30 Hep B vials become shippable (108 + 30 = 138).
    expect(
      findFailure(itemsOf({ P002: 138 }), withWarehouse('W02', { hasRefrigeratedVehicle: true })),
    ).toBeNull();
    // W04 loses its van: only W07 and W08 remain (8 + 60 = 68).
    const facts = findFailure(
      itemsOf({ P002: 100 }),
      withWarehouse('W04', { hasRefrigeratedVehicle: false }),
    );
    expect(facts?.shortfalls[0]?.available).toBe(68);
  });
});

describe('canShip', () => {
  const [gloves, hepB] = [snapshot.products[0]!, snapshot.products[1]!];
  const [w01, w02, w04] = [
    snapshot.warehouses[0]!,
    snapshot.warehouses[1]!,
    snapshot.warehouses[3]!,
  ];

  it('plain_products_ship_from_anywhere', () => {
    expect([w01, w02, w04].map((w) => canShip(w, gloves))).toEqual([true, true, true]);
  });

  it('cold_products_need_both_flags', () => {
    expect(canShip(w01, hepB)).toBe(false); // neither
    expect(canShip(w02, hepB)).toBe(false); // storage only
    expect(canShip(w04, hepB)).toBe(true);
    expect(canShip({ ...w01, hasRefrigeratedVehicle: true }, hepB)).toBe(false); // van only
  });
});
