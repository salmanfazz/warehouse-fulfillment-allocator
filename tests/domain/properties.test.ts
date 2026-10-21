import { describe, expect, it } from 'vitest';
import { planOrder, rankCandidates } from '@/domain/plan';
import { etaFor } from '@/domain/eta';
import { parseOrderedAt, toWib } from '@/domain/time';
import type { Snapshot, StockRow } from '@/domain/types';
import { baselineEta, baselineSnapshot } from './helpers';

// Small seeded generator (mulberry32) so a failure can be reproduced from its seed.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = baselineSnapshot(baselineEta());
const RUNS = 300;

function randomCase(seed: number) {
  const next = random(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const warehouses = base.warehouses.map((w) => ({
    ...w,
    hasColdStorage: next() < 0.6,
    hasRefrigeratedVehicle: next() < 0.6,
  }));
  const stock: StockRow[] = [];
  for (const w of warehouses) {
    for (const p of base.products) {
      if (next() < 0.65) stock.push({ warehouseId: w.id, productId: p.id, quantity: int(1, 300) });
    }
  }
  const snapshot: Snapshot = { ...base, warehouses, stock };
  const productIds = base.products.map((p) => p.id).sort(() => next() - 0.5);
  const items = productIds
    .slice(0, int(1, 5))
    .map((productId) => ({ productId, quantity: int(1, 400) }));
  const minute = int(0, 7 * 24 * 60 - 1);
  const ms = Date.UTC(2026, 9, 19, 0, 0) - 7 * 3600 * 1000 + minute * 60 * 1000; // a Monday 00:00 WIB plus a week
  return { snapshot, items, orderedAt: new Date(ms).toISOString().replace('.000Z', 'Z') };
}

describe('planOrder properties', () => {
  it('holds_for_random_orders_and_stock', () => {
    let plans = 0;
    let failures = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const { snapshot, items, orderedAt } = randomCase(seed);
      const label = `seed ${seed}`;
      const outcome = planOrder({ items, orderedAt }, snapshot);

      // An independent view of the rules, written out here and not borrowed from the code under test:
      // a cold-chain product ships only from a warehouse with both flags.
      const productById = new Map(snapshot.products.map((p) => [p.id, p]));
      const warehouseById = new Map(snapshot.warehouses.map((w) => [w.id, w]));
      const held = (productId: string, onlyShippable: boolean) =>
        snapshot.stock
          .filter((s) => {
            if (s.productId !== productId) return false;
            if (!onlyShippable || !productById.get(productId)!.requiresColdChain) return true;
            const w = warehouseById.get(s.warehouseId)!;
            return w.hasColdStorage && w.hasRefrigeratedVehicle;
          })
          .reduce((sum, s) => sum + s.quantity, 0);
      const expectedShortfalls = [...items]
        .sort((a, b) => (a.productId < b.productId ? -1 : 1))
        .map((i) => ({
          item: i,
          available: held(i.productId, true),
          network: held(i.productId, false),
        }))
        .filter((x) => x.available < x.item.quantity);
      expect(outcome.ok, label).toBe(expectedShortfalls.length === 0);

      if (!outcome.ok) {
        failures++;
        // Same products, same order, same figures, and the reason the rules prescribe.
        expect(outcome.failure.shortfalls, label).toEqual(
          expectedShortfalls.map((x) => ({
            productId: x.item.productId,
            requested: x.item.quantity,
            available: x.available,
          })),
        );
        const onlyColdChain = expectedShortfalls.every(
          (x) =>
            productById.get(x.item.productId)!.requiresColdChain && x.network >= x.item.quantity,
        );
        expect(outcome.failure.reason, label).toBe(
          onlyColdChain ? 'COLD_CHAIN_UNAVAILABLE' : 'INSUFFICIENT_STOCK',
        );
        continue;
      }
      plans++;
      const { plan } = outcome;

      // The plan covers the order exactly, from stock that exists, cold items only from cold-capable warehouses.
      const shipped = new Map<string, number>();
      for (const shipment of plan.shipments) {
        expect(shipment.items.length, label).toBeGreaterThan(0);
        const warehouse = warehouseById.get(shipment.warehouseId)!;
        for (const { productId, quantity } of shipment.items) {
          expect(quantity, label).toBeGreaterThan(0);
          const product = productById.get(productId)!;
          if (product.requiresColdChain)
            expect(warehouse.hasColdStorage && warehouse.hasRefrigeratedVehicle, label).toBe(true);
          const held =
            snapshot.stock.find((s) => s.warehouseId === warehouse.id && s.productId === productId)
              ?.quantity ?? 0;
          expect(
            quantity,
            `${label} ${warehouse.id}/${productId} over-allocated`,
          ).toBeLessThanOrEqual(held);
          shipped.set(productId, (shipped.get(productId) ?? 0) + quantity);
        }
        expect(shipment.vehicle, label).toBe(
          shipment.items.some((i) => productById.get(i.productId)!.requiresColdChain)
            ? 'refrigerated'
            : 'standard',
        );
      }
      expect([...shipped.keys()].sort(), label).toEqual(items.map((i) => i.productId).sort());
      for (const item of items) expect(shipped.get(item.productId), label).toBe(item.quantity);

      // Output rules.
      const ids = plan.shipments.map((s) => s.warehouseId);
      expect(ids, label).toEqual([...ids].sort());
      expect(new Set(ids).size, label).toBe(ids.length);
      expect(plan.totalMinutes, label).toBe(Math.max(...plan.shipments.map((s) => s.minutes)));
      expect(plan.totalCost, label).toBeCloseTo(
        plan.shipments.reduce((sum, s) => sum + s.cost, 0),
        6,
      );
      expect(plan.alternatives.length, label).toBeLessThanOrEqual(2);
      expect(plan.reasons.length, label).toBeGreaterThanOrEqual(3);
      expect(plan.reasons.length, label).toBeLessThanOrEqual(4);

      // The chosen plan and its alternatives are the top of the ranking, which is ordered.
      const { bucket } = toWib(parseOrderedAt(orderedAt));
      const etas = Object.fromEntries(
        snapshot.warehouses.map((w) => [w.id, etaFor(snapshot.eta, w.id, bucket)]),
      );
      const ranked = rankCandidates(items, snapshot, etas);
      expect(ids, label).toEqual(ranked[0]!.warehouseIds);
      expect(
        plan.alternatives.map((a) => a.warehouseIds),
        label,
      ).toEqual(ranked.slice(1, 3).map((c) => c.warehouseIds));
      const tie = (c: (typeof ranked)[number]) => Number(c.score.toFixed(9));
      for (let i = 1; i < ranked.length; i++) {
        const [a, b] = [ranked[i - 1]!, ranked[i]!];
        expect(tie(a) <= tie(b), `${label} rank ${i}`).toBe(true);
        if (tie(a) === tie(b))
          expect(a.warehouseIds.length <= b.warehouseIds.length, `${label} rank ${i}`).toBe(true);
      }

      // Deterministic.
      expect(planOrder({ items, orderedAt }, snapshot), label).toEqual(outcome);
    }
    // The generator must exercise both outcomes, or the checks above prove little.
    expect(plans).toBeGreaterThan(RUNS * 0.2);
    expect(failures).toBeGreaterThan(RUNS * 0.2);
  });
});
