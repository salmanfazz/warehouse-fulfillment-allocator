import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planOrder } from '@/domain/plan';
import type { OrderInput, OrderPlan, PlanOutcome, Snapshot } from '@/domain/types';
import { baselineSnapshot, itemsOf } from './helpers';

type GoldenCase = {
  name: string;
  order: Record<string, number>;
  orderedAt: string;
  expect: {
    status: number;
    reason?: string;
    shortfalls?: unknown[];
    best?: { warehouses: string[]; slowestMinutes: number; cost: number };
    alternatives?: { warehouses: string[]; slowestMinutes: number; cost: number }[];
  };
};
const golden = JSON.parse(readFileSync('tests/fixtures/golden-cases.json', 'utf8')) as GoldenCase[];
const byName = (prefix: string) => golden.find((g) => g.name.startsWith(prefix))!;

const snapshot = baselineSnapshot();
const input = (order: Record<string, number>, orderedAt: string): OrderInput => ({
  items: itemsOf(order),
  orderedAt,
});
function planOf(outcome: PlanOutcome): OrderPlan {
  if (!outcome.ok) throw new Error(`expected a plan, got ${outcome.failure.reason}`);
  return outcome.plan;
}
const run = (c: GoldenCase) => planOf(planOrder(input(c.order, c.orderedAt), snapshot));

describe('the documented example (G05)', () => {
  const plan = run(byName('G05'));

  it('g05_equals_the_documented_example', () => {
    expect(plan.orderedAt).toBe('2026-10-19T08:00:00+07:00');
    expect(plan.shipments).toEqual([
      {
        warehouseId: 'W01',
        city: 'Surabaya',
        distanceKm: 5,
        vehicle: 'standard',
        items: [{ productId: 'P001', quantity: 100 }],
        minutes: 46,
        cost: 75,
      },
      {
        warehouseId: 'W04',
        city: 'Gresik',
        distanceKm: 30,
        vehicle: 'refrigerated',
        items: [{ productId: 'P002', quantity: 10 }],
        minutes: 64,
        cost: 280,
      },
    ]);
    expect(plan.totalMinutes).toBe(64);
    expect(plan.totalCost).toBe(355);
    expect(plan.alternatives).toEqual([
      { warehouseIds: ['W03', 'W04'], totalMinutes: 64, totalCost: 455 },
      { warehouseIds: ['W04', 'W07'], totalMinutes: 68, totalCost: 555 },
    ]);
    expect(plan.reasons).toEqual([
      'Vaccines need refrigerated storage and a refrigerated van, so only W04, W07 and W08 can ship them.',
      'Chosen for a weekday-peak order: W01 + W04, about 64 min and cost 355 (speed and cost weigh equally).',
      'Next best was W03 + W04: same time but costs 100 more (455 vs 355).',
    ]);
  });

  it('response_has_exactly_the_documented_keys_and_no_score', () => {
    expect(Object.keys(plan).sort()).toEqual(
      ['alternatives', 'orderedAt', 'reasons', 'shipments', 'totalCost', 'totalMinutes'].sort(),
    );
    expect(Object.keys(plan.shipments[0]!).sort()).toEqual(
      ['city', 'cost', 'distanceKm', 'items', 'minutes', 'vehicle', 'warehouseId'].sort(),
    );
    expect(Object.keys(plan.alternatives[0]!).sort()).toEqual([
      'totalCost',
      'totalMinutes',
      'warehouseIds',
    ]);
    expect(JSON.stringify(plan)).not.toMatch(/score/i);
  });

  it('total_minutes_is_the_slowest_shipment_and_total_cost_is_the_sum', () => {
    expect(plan.totalMinutes).toBe(Math.max(...plan.shipments.map((s) => s.minutes)));
    expect(plan.totalCost).toBe(plan.shipments.reduce((sum, s) => sum + s.cost, 0));
  });

  it('utc_input_is_reported_in_wib', () => {
    const utc = run(byName('G09'));
    expect(utc.orderedAt).toBe('2026-10-19T08:00:00+07:00');
    expect(utc.shipments).toEqual(plan.shipments);
  });
});

describe('all eight successful golden cases through planOrder', () => {
  for (const c of golden.filter((g) => g.expect.status === 200)) {
    it(c.name, () => {
      const plan = run(c);
      const best = c.expect.best!;
      expect(plan.shipments.map((s) => s.warehouseId)).toEqual(best.warehouses);
      expect(plan.alternatives.map((a) => a.warehouseIds)).toEqual(
        c.expect.alternatives!.map((a) => a.warehouses),
      );
      expect(plan.totalCost).toBe(best.cost);
      expect(plan.totalMinutes).toBe(Math.round(best.slowestMinutes));
      plan.alternatives.forEach((alt, i) => {
        expect(alt.totalCost).toBe(c.expect.alternatives![i]!.cost);
        expect(alt.totalMinutes).toBe(Math.round(c.expect.alternatives![i]!.slowestMinutes));
      });
      expect(plan.reasons.length).toBeGreaterThanOrEqual(3);
      expect(plan.reasons.length).toBeLessThanOrEqual(4);
    });
  }

  it('shipment_items_are_in_ascending_product_id_and_shipments_in_warehouse_order', () => {
    const plan = planOf(
      planOrder(input({ P005: 20, P003: 20, P001: 20 }, '2026-10-20T13:00:00+07:00'), snapshot),
    );
    for (const shipment of plan.shipments) {
      const ids = shipment.items.map((i) => i.productId);
      expect(ids).toEqual([...ids].sort());
    }
    const warehouseIds = plan.shipments.map((s) => s.warehouseId);
    expect(warehouseIds).toEqual([...warehouseIds].sort());
  });

  it('g06_says_that_one_warehouse_could_have_covered_everything', () => {
    const plan = run(byName('G06'));
    expect(plan.shipments.length).toBeGreaterThan(1);
    // W07 is also the runner-up, which the sentence has just named
    expect(plan.reasons[2]).toContain('Next best was W07:');
    expect(plan.reasons[2]).toContain('that one warehouse could cover the whole order');
  });

  it('g02_has_a_limited_history_sentence_for_w08', () => {
    const plan = run(byName('G02'));
    expect(plan.reasons).toHaveLength(4);
    expect(plan.reasons[3]).toBe('Delivery time for W08 rests on limited history.');
  });
});

describe('failures', () => {
  it('failure_outcomes_match_golden_422', () => {
    const infos: Record<string, string> = {
      G03: 'Only 108 of 158 units of Vaccine - Hepatitis B (10-dose vial) can be shipped with cold chain',
      G10: 'Only 85 of 135 units of Vaccine - Tetanus Toxoid (10-dose vial) can be shipped with cold chain',
      G11: 'Not enough stock for Surgical Gloves (Box of 100): requested 5000, available 1100',
    };
    for (const c of golden.filter((g) => g.expect.status === 422)) {
      const outcome = planOrder(input(c.order, c.orderedAt), snapshot);
      expect(outcome.ok, c.name).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.failure.reason).toBe(c.expect.reason);
      expect(outcome.failure.shortfalls).toEqual(c.expect.shortfalls);
      expect(outcome.failure.info).toBe(infos[c.name.slice(0, 3)]);
    }
  });

  it('unknown_product_is_a_failure_not_an_exception', () => {
    const outcome = planOrder(input({ P999: 2 }, '2026-10-20T13:00:00+07:00'), snapshot);
    expect(outcome).toEqual({
      ok: false,
      failure: {
        reason: 'UNKNOWN_PRODUCT',
        info: 'Unknown product: P999',
        shortfalls: [{ productId: 'P999', requested: 2, available: 0 }],
      },
    });
  });
});

describe('cold-capable warehouses in the reasons', () => {
  it('sentence_1_follows_the_warehouse_flags_not_their_ids', () => {
    const withVan: Snapshot = {
      ...snapshot,
      warehouses: snapshot.warehouses.map((w) =>
        w.id === 'W02' ? { ...w, hasRefrigeratedVehicle: true } : w,
      ),
    };
    const plan = planOf(planOrder(input({ P002: 10 }, '2026-10-20T13:00:00+07:00'), withVan));
    expect(plan.reasons[0]).toBe(
      'Vaccines need refrigerated storage and a refrigerated van, so only W02, W04, W07 and W08 can ship them.',
    );
  });
});

describe('guards and purity', () => {
  const at = '2026-10-20T13:00:00+07:00';

  it('items_in_any_order_give_the_same_plan', () => {
    const a = planOrder(input({ P001: 100, P002: 10 }, at), snapshot);
    const b = planOrder(input({ P002: 10, P001: 100 }, at), snapshot);
    expect(b).toEqual(a);
  });

  it('duplicate_product_throws_range_error', () => {
    const items = [
      { productId: 'P001', quantity: 1 },
      { productId: 'P001', quantity: 2 },
    ];
    expect(() => planOrder({ items, orderedAt: at }, snapshot)).toThrow(RangeError);
  });

  it('zero_negative_or_fractional_quantity_throws_range_error', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        planOrder({ items: [{ productId: 'P001', quantity }], orderedAt: at }, snapshot),
      ).toThrow(RangeError);
    }
  });

  it('empty_items_throw_range_error', () => {
    expect(() => planOrder({ items: [], orderedAt: at }, snapshot)).toThrow(RangeError);
  });

  it('unparseable_ordered_at_throws_range_error', () => {
    for (const orderedAt of ['', 'tomorrow', '2026-10-20T13:00:00', '2026-02-30T00:00:00Z']) {
      expect(() => planOrder(input({ P001: 1 }, orderedAt), snapshot)).toThrow(RangeError);
    }
  });

  it('a_warehouse_without_delivery_time_estimates_is_an_error_not_a_guess', () => {
    const broken: Snapshot = { ...snapshot, eta: {} };
    expect(() => planOrder(input({ P001: 1 }, at), broken)).toThrow(/No delivery time estimate/);
  });

  it('plan_order_does_not_mutate_its_inputs', () => {
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const frozenSnapshot = deepFreeze(structuredClone(snapshot));
    const frozenInput = deepFreeze(input({ P002: 10, P001: 100 }, at));
    expect(() => planOrder(frozenInput, frozenSnapshot)).not.toThrow();
  });
});
