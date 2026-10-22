import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultPanel } from '@/app/ui/ResultPanel';
import type { PlanData, ResultState } from '@/app/ui/types';

const plan: PlanData = {
  orderedAt: '2026-10-19T08:00:00+07:00',
  shipments: [
    {
      warehouseId: 'W04',
      city: 'Gresik',
      distanceKm: 30,
      vehicle: 'refrigerated',
      items: [{ productId: 'P002', quantity: 40 }],
      minutes: 64,
      cost: 280,
    },
    {
      warehouseId: 'W07',
      city: 'Pasuruan',
      distanceKm: 45,
      vehicle: 'refrigerated',
      items: [{ productId: 'P002', quantity: 5 }],
      minutes: 68,
      cost: 385,
    },
  ],
  totalMinutes: 68,
  totalCost: 665,
  reasons: [
    'Vaccines need refrigerated storage and a refrigerated van.',
    'Chosen for a weekday-peak order: W04 + W07, about 68 min and cost 665 (speed and cost weigh equally).',
  ],
  alternatives: [{ warehouseIds: ['W04', 'W08'], totalMinutes: 70, totalCost: 765 }],
};

const render = (result: ResultState) =>
  renderToStaticMarkup(createElement(ResultPanel, { result, nameOf: (id: string) => id }));

describe('ResultPanel plan', () => {
  const html = render({ kind: 'plan', placed: false, plan });

  it('shows_every_cost_in_rupiah_and_never_cost_units', () => {
    expect(html).toContain('Rp 280.000');
    expect(html).toContain('Rp 385.000');
    expect(html).toContain('Rp 665.000');
    expect(html).not.toContain('cost units');
  });

  it('explains_each_shipment_cost_step_by_step', () => {
    expect(html).toContain('(Rp 50.000 + 30 km × Rp 5.000) × 1.4 = Rp 200.000 × 1.4 = Rp 280.000');
    expect(html).toContain('(Rp 50.000 + 45 km × Rp 5.000) × 1.4 = Rp 275.000 × 1.4 = Rp 385.000');
  });

  it('shows_the_reasons_with_rupiah_too', () => {
    expect(html).toContain('about 68 min and cost Rp 665.000 (speed and cost weigh equally)');
    expect(html).not.toContain('cost 665 ');
  });

  it('explains_how_the_totals_are_made', () => {
    expect(html).toContain('the slowest shipment');
    expect(html).toContain('the shipments added together');
  });

  it('states_the_cost_formula_with_parentheses_before_the_lines', () => {
    expect(html).toContain('Shipment cost = (fixed fee + km × rate per km) × multiplier');
  });

  it('compares_all_plans_side_by_side_with_real_figures', () => {
    const table = html.slice(html.indexOf('Plans compared'));
    expect(table).toContain('Chosen');
    expect(table).toContain('W04 + W07');
    expect(table).toContain('Rp 665.000');
    expect(table).toContain('W04 + W08');
    expect(table).toContain('Rp 765.000');
    expect(table.indexOf('W04 + W07')).toBeLessThan(table.indexOf('W04 + W08'));
    expect(html).not.toContain('vs chosen');
  });

  it('explains_how_the_best_plan_is_chosen_without_a_score', () => {
    expect(html).toContain('How the best plan is chosen');
    expect(html).toContain('equally');
    expect(html).toContain('Rp 500.000');
    expect(html).not.toMatch(/score/i);
  });
});
