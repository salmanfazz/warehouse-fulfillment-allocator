import { describe, expect, it } from 'vitest';
import { explainFailure, explainPlan, listIds, type PlanContext } from '@/domain/explain';
import { findFailure } from '@/domain/plan';
import type { Candidate } from '@/domain/types';
import { baselineSnapshot, itemsOf } from './helpers';

const snapshot = baselineSnapshot();
const candidate = (warehouseIds: string[], slowestMinutes: number, cost: number): Candidate => ({
  warehouseIds,
  allocation: {},
  slowestMinutes,
  cost,
  score: 0,
});

// The G05 situation: 10 Hep B and 100 gloves, Monday 08:00.
function context(over: Partial<PlanContext> = {}): PlanContext {
  return {
    items: itemsOf({ P001: 100, P002: 10 }),
    products: snapshot.products,
    coldCapableIds: ['W04', 'W07', 'W08'],
    bucket: 'peak',
    chosen: candidate(['W01', 'W04'], 63.75, 355),
    alternatives: [candidate(['W03', 'W04'], 63.75, 455), candidate(['W04', 'W07'], 67.5, 555)],
    singleWarehouse: null,
    recordsInBucket: { W01: 4, W04: 2 },
    ...over,
  };
}
const third = (over: Partial<PlanContext>) => explainPlan(context(over))[2];
const next = (slowest: number, cost: number, chosen = candidate(['W01', 'W04'], 60, 300)) => ({
  chosen,
  alternatives: [candidate(['W03', 'W04'], slowest, cost)],
});

describe('listIds', () => {
  it('reads_like_a_sentence', () => {
    expect(listIds(['W04'])).toBe('W04');
    expect(listIds(['W04', 'W07'])).toBe('W04 and W07');
    expect(listIds(['W04', 'W07', 'W08'])).toBe('W04, W07 and W08');
  });
});

describe('sentence 1', () => {
  it('sentence_1_for_hep_b_lists_capable_warehouses', () => {
    expect(explainPlan(context())[0]).toBe(
      'Vaccines need refrigerated storage and a refrigerated van, so only W04, W07 and W08 can ship them.',
    );
  });

  it('no_stock_held_elsewhere_clause_in_success_reasons', () => {
    // W02 and W06 hold Hep B but cannot ship it; the reasons stay silent about that.
    const first = explainPlan(context())[0]!;
    expect(first).not.toMatch(/W02|W06|held|elsewhere/);
  });

  it('sentence_1_for_orders_without_cold_products', () => {
    expect(explainPlan(context({ items: itemsOf({ P001: 100 }) }))[0]).toBe(
      'None of the ordered products needs cold chain, so any warehouse holding them can ship them.',
    );
  });

  it('explain_uses_the_cold_capable_list_it_is_given', () => {
    // explain holds no cold-chain rule of its own: it prints the list it receives
    expect(explainPlan(context({ coldCapableIds: ['W02', 'W04'] }))[0]).toContain(
      'only W02 and W04 can ship',
    );
    expect(explainPlan(context({ coldCapableIds: ['W08'] }))[0]).toContain('only W08 can ship');
  });
});

describe('sentence 2', () => {
  it('matches_the_documented_example', () => {
    expect(explainPlan(context())[1]).toBe(
      'Chosen for a weekday-peak order: W01 + W04, about 64 min and cost 355 (speed and cost weigh equally).',
    );
  });

  it('labels_every_bucket', () => {
    expect(explainPlan(context({ bucket: 'off_peak' }))[1]).toContain('a weekday-off-peak order');
    expect(explainPlan(context({ bucket: 'weekend' }))[1]).toContain('a weekend order');
  });

  it('rounds_minutes_half_up_and_prints_the_cost_as_is', () => {
    const chosen = candidate(['W01'], 63.5, 244.5);
    expect(explainPlan(context({ chosen }))[1]).toContain('about 64 min and cost 244.5 ');
  });
});

describe('sentence 3', () => {
  it('same_time_costs_more_matches_the_approved_wording', () => {
    expect(third({})).toBe('Next best was W03 + W04: same time but costs 100 more (455 vs 355).');
  });

  it('slower_but_cheaper', () => {
    expect(third(next(70, 250))).toBe(
      'Next best was W03 + W04: 10 min slower but costs 50 less (250 vs 300).',
    );
  });

  it('faster_but_costlier', () => {
    expect(third(next(50, 400))).toBe(
      'Next best was W03 + W04: 10 min faster but costs 100 more (400 vs 300).',
    );
  });

  it('slower_and_costlier', () => {
    expect(third(next(70, 400))).toBe(
      'Next best was W03 + W04: 10 min slower and costs 100 more (400 vs 300).',
    );
  });

  it('slower_at_the_same_cost', () => {
    expect(third(next(70, 300))).toBe('Next best was W03 + W04: 10 min slower but same cost.');
  });

  it('same_time_cheaper_and_same_time_same_cost', () => {
    expect(third(next(60, 250))).toBe(
      'Next best was W03 + W04: same time and costs 50 less (250 vs 300).',
    );
    expect(third(next(60, 300))).toBe('Next best was W03 + W04: same time and same cost.');
  });

  it('minutes_are_compared_after_rounding', () => {
    const chosen = candidate(['W01', 'W04'], 63.75, 355); // 64 min
    expect(third({ chosen, alternatives: [candidate(['W03', 'W04'], 64.4, 455)] })).toContain(
      'same time',
    );
    expect(third({ chosen, alternatives: [candidate(['W03', 'W04'], 64.5, 455)] })).toContain(
      '1 min slower',
    );
  });

  it('single_warehouse_note_names_the_warehouse', () => {
    const singleWarehouse = candidate(['W07'], 90, 400);
    expect(third({ singleWarehouse })).toBe(
      'Next best was W03 + W04: same time but costs 100 more (455 vs 355); ' +
        'one warehouse (W07) could cover the whole order, but the split is better on speed and cost together.',
    );
  });

  it('single_warehouse_note_says_that_one_warehouse_when_it_is_the_runner_up', () => {
    const only = candidate(['W07'], 90, 400);
    expect(third({ alternatives: [only], singleWarehouse: only })).toBe(
      'Next best was W07: 26 min slower and costs 45 more (400 vs 355); ' +
        'that one warehouse could cover the whole order, but the split is better on speed and cost together.',
    );
  });

  it('no_alternative', () => {
    expect(third({ alternatives: [] })).toBe(
      'No other warehouse combination can cover this order.',
    );
  });
});

describe('sentence 4 and the count', () => {
  it('sentence_4_singular', () => {
    const reasons = explainPlan(context({ recordsInBucket: { W01: 4, W04: 1 } }));
    expect(reasons[3]).toBe('Delivery time for W04 rests on limited history.');
  });

  it('sentence_4_plural', () => {
    const reasons = explainPlan(context({ recordsInBucket: { W01: 0, W04: 1 } }));
    expect(reasons[3]).toBe('Delivery times for W01 and W04 rest on limited history.');
  });

  it('sentence_4_absent_when_every_used_warehouse_has_two_or_more_records', () => {
    expect(explainPlan(context({ recordsInBucket: { W01: 2, W04: 2 } }))).toHaveLength(3);
  });

  it('sentence_4_only_looks_at_warehouses_in_the_chosen_plan', () => {
    expect(
      explainPlan(context({ recordsInBucket: { W01: 4, W04: 2, W03: 0, W07: 0 } })),
    ).toHaveLength(3);
  });

  it('every_reason_entry_is_a_single_sentence', () => {
    const variants = [
      context(),
      context({ recordsInBucket: { W01: 0, W04: 0 } }),
      context({ items: itemsOf({ P001: 5 }) }),
      context({ singleWarehouse: candidate(['W07'], 90, 400) }),
      context({ chosen: candidate(['W01'], 63.5, 244.5), alternatives: [] }),
    ];
    for (const ctx of variants) {
      for (const entry of explainPlan(ctx)) {
        expect(entry.match(/\.(\s|$)/g), entry).toHaveLength(1); // decimals like 244.5 do not count
        expect(entry.endsWith('.'), entry).toBe(true);
      }
    }
  });

  it('reasons_count_is_three_or_four', () => {
    expect(explainPlan(context())).toHaveLength(3);
    expect(explainPlan(context({ recordsInBucket: { W01: 0, W04: 4 } }))).toHaveLength(4);
    expect(explainPlan(context({ items: itemsOf({ P001: 5 }) }))).toHaveLength(3);
  });
});

describe('explainFailure', () => {
  const info = (order: Record<string, number>) =>
    explainFailure(findFailure(itemsOf(order), snapshot)!, snapshot.products);

  it('info_cold_chain', () => {
    expect(info({ P002: 120 })).toBe(
      'Only 108 of 158 units of Vaccine - Hepatitis B (10-dose vial) can be shipped with cold chain',
    );
  });

  it('info_stock', () => {
    expect(info({ P001: 5000 })).toBe(
      'Not enough stock for Surgical Gloves (Box of 100): requested 5000, available 1100',
    );
  });

  it('info_unknown', () => {
    expect(info({ P999: 3 })).toBe('Unknown product: P999');
  });

  it('info_adds_and_n_more', () => {
    expect(info({ P002: 120, P004: 100 })).toBe(
      'Only 108 of 158 units of Vaccine - Hepatitis B (10-dose vial) can be shipped with cold chain (and 1 more)',
    );
    expect(info({ P998: 1, P999: 3 })).toBe('Unknown product: P998 (and 1 more)');
  });

  it('info_first_shortfall_is_lowest_product_id_and_uses_its_own_cause', () => {
    expect(info({ P002: 120, P001: 5000 })).toBe(
      'Not enough stock for Surgical Gloves (Box of 100): requested 5000, available 1100 (and 1 more)',
    );
  });
});
