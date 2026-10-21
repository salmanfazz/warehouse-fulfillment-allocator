import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etaFor } from '@/domain/eta';
import { rankCandidates } from '@/domain/plan';
import { parseOrderedAt, toWib } from '@/domain/time';
import type { Allocation, Candidate } from '@/domain/types';
import { baselineEta, baselineSnapshot, itemsOf } from './helpers';

type Plan = {
  warehouses: string[];
  allocation: Allocation;
  slowestMinutes: number;
  cost: number;
  score: number;
};
type GoldenCase = {
  name: string;
  order: Record<string, number>;
  orderedAt: string;
  expect: { status: number; timeBucket?: string; best?: Plan; alternatives?: Plan[] };
};
const golden = JSON.parse(readFileSync('tests/fixtures/golden-cases.json', 'utf8')) as GoldenCase[];

const eta = baselineEta();
const snapshot = baselineSnapshot(eta);

function expectPlan(got: Candidate | undefined, want: Plan, label: string) {
  expect(got, label).toBeDefined();
  expect(got!.warehouseIds, `${label} warehouses`).toEqual(want.warehouses);
  expect(got!.allocation, `${label} allocation`).toEqual(want.allocation);
  expect(Math.abs(got!.slowestMinutes - want.slowestMinutes), `${label} slowest`).toBeLessThan(
    0.01,
  );
  expect(got!.cost, `${label} cost`).toBe(want.cost);
  expect(Math.abs(got!.score - want.score), `${label} score`).toBeLessThan(1e-6);
}

describe('rankCandidates on the golden cases', () => {
  for (const c of golden.filter((g) => g.expect.status === 200)) {
    it(c.name, () => {
      const { bucket } = toWib(parseOrderedAt(c.orderedAt));
      expect(bucket).toBe(c.expect.timeBucket);
      const etas = Object.fromEntries(
        snapshot.warehouses.map((w) => [w.id, etaFor(eta, w.id, bucket)]),
      );

      const ranked = rankCandidates(itemsOf(c.order), snapshot, etas);

      expectPlan(ranked[0], c.expect.best!, 'best');
      expect(c.expect.alternatives).toHaveLength(2);
      c.expect.alternatives!.forEach((alt, i) =>
        expectPlan(ranked[i + 1], alt, `alternative ${i + 1}`),
      );
    });
  }
});
