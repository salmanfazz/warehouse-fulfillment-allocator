import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reasonInRupiah } from '@/app/ui/format';
import { planOrder } from '@/domain/plan';
import { baselineSnapshot, itemsOf } from '../domain/helpers';

describe('reasonInRupiah', () => {
  it('rewrites_the_chosen_plan_sentence', () => {
    expect(
      reasonInRupiah(
        'Chosen for a weekday-peak order: W01 + W04, about 64 min and cost 355 (speed and cost weigh equally).',
      ),
    ).toBe(
      'Chosen for a weekday-peak order: W01 + W04, about 64 min and cost Rp 355.000 (speed and cost weigh equally).',
    );
  });

  it('rewrites_the_comparison_difference_and_both_figures', () => {
    expect(
      reasonInRupiah('Next best was W03 + W04: same time but costs 100 more (455 vs 355).'),
    ).toBe(
      'Next best was W03 + W04: same time but costs Rp 100.000 more (Rp 455.000 vs Rp 355.000).',
    );
    expect(reasonInRupiah('Next best was W07: 4 min faster and costs 60 less (295 vs 355).')).toBe(
      'Next best was W07: 4 min faster and costs Rp 60.000 less (Rp 295.000 vs Rp 355.000).',
    );
  });

  it('leaves_sentences_without_money_alone', () => {
    const same = 'Next best was W03 + W04: same time and same cost.';
    expect(reasonInRupiah(same)).toBe(same);
    const cold =
      'Vaccines need refrigerated storage and a refrigerated van, so only W04 can ship them.';
    expect(reasonInRupiah(cold)).toBe(cold);
  });
});

// The rewrite reads the planner's wording, so this runs the real planner on every golden case and
// fails if a sentence still carries a bare cost number after the rewrite (the wording drifted).
describe('reasonInRupiah on the real reasons', () => {
  const golden = JSON.parse(readFileSync('tests/fixtures/golden-cases.json', 'utf8')) as {
    name: string;
    order: Record<string, number>;
    orderedAt: string;
    expect: { status: number };
  }[];
  const snapshot = baselineSnapshot();

  for (const c of golden.filter((g) => g.expect.status === 200)) {
    it(c.name, () => {
      const outcome = planOrder({ items: itemsOf(c.order), orderedAt: c.orderedAt }, snapshot);
      if (!outcome.ok) throw new Error('expected a plan');
      const text = outcome.plan.reasons.map(reasonInRupiah).join(' ');
      expect(text).not.toMatch(/\bcosts? \d/);
      expect(text).not.toMatch(/\(\d+(\.\d+)? vs /);
      expect(text).toMatch(/Rp \d/);
    });
  }
});
