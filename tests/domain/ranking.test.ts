import { describe, expect, it } from 'vitest';
import { PLAN } from '@/config';
import { rankCandidates, shipmentCost } from '@/domain/plan';
import type { Product, Snapshot, Warehouse } from '@/domain/types';
import { baselineSnapshot, itemsOf } from './helpers';

const product = (id: string, cold = false): Product => ({
  id,
  name: id,
  category: 'test',
  requiresColdChain: cold,
});
const warehouse = (id: string, km: number, cold = false): Warehouse => ({
  id,
  city: 'Test',
  distanceKm: km,
  hasColdStorage: cold,
  hasRefrigeratedVehicle: cold,
});
function snapshotOf(
  warehouses: Warehouse[],
  products: Product[],
  stock: [warehouseId: string, productId: string, quantity: number][],
): Snapshot {
  return {
    products,
    warehouses,
    stock: stock.map(([warehouseId, productId, quantity]) => ({
      warehouseId,
      productId,
      quantity,
    })),
    eta: {},
  };
}
const ids = (ranked: ReturnType<typeof rankCandidates>) =>
  ranked.map((c) => c.warehouseIds.join('+'));

describe('ranking and tie-breaks', () => {
  it('equal_scores_prefer_fewer_shipments', () => {
    // {WA}: 0.5*100/200 + 0.5*100/500 = 0.35. {WB,WC}: 0.5*60/200 + 0.5*200/500 = 0.35.
    const snap = snapshotOf(
      [warehouse('WA', 10), warehouse('WB', 10), warehouse('WC', 10)],
      [product('PX')],
      [
        ['WA', 'PX', 10],
        ['WB', 'PX', 5],
        ['WC', 'PX', 5],
      ],
    );
    const ranked = rankCandidates(itemsOf({ PX: 10 }), snap, { WA: 100, WB: 60, WC: 60 });
    expect(ids(ranked).slice(0, 2)).toEqual(['WA', 'WB+WC']);
    expect(ranked[0]!.score).toBeCloseTo(ranked[1]!.score, 12);
  });

  it('equal_scores_and_shipments_prefer_lexicographically_smaller_ids', () => {
    const snap = snapshotOf(
      [warehouse('WA', 10), warehouse('WB', 10), warehouse('WC', 10)],
      [product('PX')],
      [
        ['WA', 'PX', 10],
        ['WB', 'PX', 10],
        ['WC', 'PX', 10],
      ],
    );
    const ranked = rankCandidates(itemsOf({ PX: 10 }), snap, { WA: 50, WB: 50, WC: 50 });
    expect(ids(ranked).slice(0, 3)).toEqual(['WA', 'WB', 'WC']);
  });

  it('scores_equal_after_rounding_to_9_decimals_count_as_ties', () => {
    // WB is faster by 1e-9 minutes, a score difference of 2.5e-12: below the tie precision.
    const snap = snapshotOf(
      [warehouse('WA', 10), warehouse('WB', 10)],
      [product('PX')],
      [
        ['WA', 'PX', 10],
        ['WB', 'PX', 10],
      ],
    );
    const ranked = rankCandidates(itemsOf({ PX: 10 }), snap, { WA: 100, WB: 100 - 1e-9 });
    const score = (key: string) => ranked.find((c) => c.warehouseIds.join('+') === key)!.score;
    expect(score('WB')).toBeLessThan(score('WA')); // WB really is a hair better...
    expect(ids(ranked).slice(0, 2)).toEqual(['WA', 'WB']); // ...but it is a tie, so the id decides
  });

  it('a_visible_score_difference_still_decides', () => {
    const snap = snapshotOf(
      [warehouse('WA', 10), warehouse('WB', 10)],
      [product('PX')],
      [
        ['WA', 'PX', 10],
        ['WB', 'PX', 10],
      ],
    );
    const ranked = rankCandidates(itemsOf({ PX: 10 }), snap, { WA: 100, WB: 99 });
    expect(ids(ranked).slice(0, 2)).toEqual(['WB', 'WA']);
  });

  it('allocation_sorts_by_eta_then_id', () => {
    const snap = snapshotOf(
      [warehouse('WA', 10), warehouse('WB', 10)],
      [product('PX')],
      [
        ['WA', 'PX', 10],
        ['WB', 'PX', 10],
      ],
    );
    const both = (etas: Record<string, number>) =>
      rankCandidates(itemsOf({ PX: 15 }), snap, etas).find((c) => c.warehouseIds.length === 2)!;
    expect(both({ WA: 50, WB: 50 }).allocation).toEqual({ WA: { PX: 10 }, WB: { PX: 5 } }); // tie: lower id first
    expect(both({ WA: 50, WB: 40 }).allocation).toEqual({ WA: { PX: 5 }, WB: { PX: 10 } }); // faster first
  });
});

describe('candidates', () => {
  const snapshot = baselineSnapshot();
  const etas = Object.fromEntries(snapshot.warehouses.map((w, i) => [w.id, 40 + i]));

  it('every_warehouse_in_a_plan_ships_something', () => {
    const ranked = rankCandidates(itemsOf({ P001: 10, P002: 5 }), snapshot, etas);
    expect(ranked.length).toBeGreaterThan(1);
    for (const c of ranked) {
      expect(Object.keys(c.allocation).sort()).toEqual(c.warehouseIds);
      for (const lines of Object.values(c.allocation))
        expect(Object.keys(lines).length).toBeGreaterThan(0);
    }
  });

  it('a_subset_that_cannot_cover_the_order_is_skipped', () => {
    const ranked = rankCandidates(itemsOf({ P002: 108 }), snapshot, etas); // needs all of W04, W07, W08
    expect(ids(ranked)).toEqual(['W04+W07+W08']);
  });

  it('products_are_allocated_in_id_order_regardless_of_request_order', () => {
    const a = rankCandidates(itemsOf({ P003: 5, P001: 5, P005: 5 }), snapshot, etas);
    const b = rankCandidates(itemsOf({ P005: 5, P003: 5, P001: 5 }), snapshot, etas);
    expect(a).toEqual(b);
    expect(Object.keys(a[0]!.allocation.W01!)).toEqual(['P001', 'P003', 'P005']);
  });

  it('input_is_not_mutated', () => {
    const items = itemsOf({ P003: 5, P001: 5 });
    const copy = structuredClone(items);
    rankCandidates(items, snapshot, etas);
    expect(items).toEqual(copy);
  });
});

describe('cost', () => {
  const snapshot = baselineSnapshot();
  const etas = Object.fromEntries(snapshot.warehouses.map((w) => [w.id, 50]));
  const only = (ranked: ReturnType<typeof rankCandidates>, key: string) =>
    ranked.find((c) => c.warehouseIds.join('+') === key)!;

  it('cold_multiplier_applies_per_shipment_with_a_cold_item', () => {
    const split = only(rankCandidates(itemsOf({ P001: 100, P002: 10 }), snapshot, etas), 'W01+W04');
    expect(split.cost).toBe(75 + 280); // gloves shipment x1, vaccine shipment x1.4
  });

  it('a_shipment_mixing_cold_and_plain_items_is_multiplied_as_a_whole', () => {
    const mixed = only(rankCandidates(itemsOf({ P001: 10, P002: 5 }), snapshot, etas), 'W07');
    expect(mixed.cost).toBe(385); // (50 + 5*45) * 1.4
    const plain = only(rankCandidates(itemsOf({ P001: 10 }), snapshot, etas), 'W07');
    expect(plain.cost).toBe(275); // no cold item: no multiplier
  });

  it('cost_is_free_of_float_noise', () => {
    expect((50 + 5 * 25) * 1.4).not.toBe(245); // the raw arithmetic is 244.99999999999997
    const snap = snapshotOf([warehouse('WC', 25, true)], [product('PC', true)], [['WC', 'PC', 5]]);
    const [only1] = rankCandidates(itemsOf({ PC: 5 }), snap, { WC: 10 });
    expect(only1!.cost).toBe(245);
  });

  it('shipment_cost_uses_the_flat_part_the_distance_part_and_the_multiplier', () => {
    expect(shipmentCost(warehouse('WX', 10), false)).toBe(100);
    expect(shipmentCost(warehouse('WX', 10), true)).toBeCloseTo(140, 12);
  });
});

describe('rankCandidates guards', () => {
  const snapshot = baselineSnapshot();
  const etas = Object.fromEntries(snapshot.warehouses.map((w) => [w.id, 50]));

  it('rank_candidates_rejects_duplicate_or_bad_items', () => {
    const dup = [
      { productId: 'P001', quantity: 100 },
      { productId: 'P001', quantity: 150 },
    ];
    expect(() => rankCandidates(dup, snapshot, etas)).toThrow(RangeError);
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() => rankCandidates([{ productId: 'P001', quantity }], snapshot, etas)).toThrow(
        RangeError,
      );
    }
    expect(() => rankCandidates([], snapshot, etas)).toThrow(RangeError);
  });

  it('rank_candidates_rejects_a_missing_or_non_finite_eta', () => {
    const items = itemsOf({ P001: 10 });
    const missing = Object.fromEntries(Object.entries(etas).filter(([id]) => id !== 'W03'));
    expect(() => rankCandidates(items, snapshot, missing)).toThrow(/W03/);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rankCandidates(items, snapshot, { ...etas, W03: bad })).toThrow(/W03/);
    }
  });

  it('rank_candidates_rejects_more_warehouses_than_the_cap', () => {
    const many = Array.from({ length: PLAN.maxWarehouses + 1 }, (_, i) =>
      warehouse(`X${String(i).padStart(2, '0')}`, 10),
    );
    const snap = snapshotOf(
      many,
      [product('PX')],
      many.map((w) => [w.id, 'PX', 5] as [string, string, number]),
    );
    const manyEtas = Object.fromEntries(many.map((w) => [w.id, 10]));
    expect(() => rankCandidates(itemsOf({ PX: 1 }), snap, manyEtas)).toThrow(/At most/);
  });

  it('exactly_the_cap_is_accepted', () => {
    const many = Array.from({ length: PLAN.maxWarehouses }, (_, i) =>
      warehouse(`X${String(i).padStart(2, '0')}`, 10),
    );
    const snap = snapshotOf(
      many,
      [product('PX')],
      many.map((w) => [w.id, 'PX', 5] as [string, string, number]),
    );
    const manyEtas = Object.fromEntries(many.map((w) => [w.id, 10]));
    expect(rankCandidates(itemsOf({ PX: 1 }), snap, manyEtas).length).toBeGreaterThan(0);
  });
});
