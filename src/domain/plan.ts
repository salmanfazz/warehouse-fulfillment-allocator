import { PLAN } from '@/config';
import type {
  Allocation,
  Candidate,
  FailureFacts,
  OrderItem,
  Product,
  ShortfallFact,
  Snapshot,
  Warehouse,
} from './types';

const byProductId = (a: OrderItem, b: OrderItem) =>
  a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;

// A cold-chain product can only ship from a warehouse with both cold storage and a
// refrigerated vehicle. Decided by the two flags, never by warehouse id.
export function canShip(warehouse: Warehouse, product: Product): boolean {
  return (
    !product.requiresColdChain || (warehouse.hasColdStorage && warehouse.hasRefrigeratedVehicle)
  );
}

// What stops this order from being fulfilled, or null if shippable stock covers all of it.
// Unknown product ids come first. Otherwise each product is compared with the stock that may
// ship it ("shippable") and the stock held anywhere ("network"): short but present elsewhere
// is a cold-chain problem; short everywhere is a stock problem. Shortfalls are in product id order.
export function findFailure(
  items: OrderItem[],
  snapshot: Pick<Snapshot, 'products' | 'warehouses' | 'stock'>,
): FailureFacts | null {
  const ordered = [...items].sort(byProductId);
  const products = new Map(snapshot.products.map((p) => [p.id, p]));
  const warehouses = new Map(snapshot.warehouses.map((w) => [w.id, w]));

  const unknown: ShortfallFact[] = ordered
    .filter((item) => !products.has(item.productId))
    .map((item) => ({
      productId: item.productId,
      requested: item.quantity,
      available: 0,
      network: 0,
      cause: 'UNKNOWN',
    }));
  if (unknown.length > 0) return { reason: 'UNKNOWN_PRODUCT', shortfalls: unknown };

  const shortfalls: ShortfallFact[] = [];
  for (const item of ordered) {
    const product = products.get(item.productId) as Product;
    let network = 0;
    let shippable = 0;
    for (const row of snapshot.stock) {
      const warehouse = warehouses.get(row.warehouseId);
      if (row.productId !== product.id || !warehouse) continue;
      network += row.quantity;
      if (canShip(warehouse, product)) shippable += row.quantity;
    }
    if (shippable >= item.quantity) continue;
    const cause = product.requiresColdChain && network >= item.quantity ? 'COLD_CHAIN' : 'STOCK';
    shortfalls.push({
      productId: product.id,
      requested: item.quantity,
      available: shippable,
      network,
      cause,
    });
  }
  if (shortfalls.length === 0) return null;

  const onlyCold = shortfalls.every((s) => s.cause === 'COLD_CHAIN');
  return { reason: onlyCold ? 'COLD_CHAIN_UNAVAILABLE' : 'INSUFFICIENT_STOCK', shortfalls };
}

type Etas = Record<string, number>; // warehouse id -> estimated minutes for the order's time bucket

const roundTo = (value: number, decimals: number) => Number(value.toFixed(decimals));

// One shipment: a flat part plus a distance part, times the cold multiplier if it holds any
// cold-chain item. Not rounded here: rounding happens when costs are reported.
export function shipmentCost(warehouse: Warehouse, hasColdItem: boolean): number {
  const base = PLAN.baseCostPerShipment + PLAN.costPerKm * warehouse.distanceKm;
  return hasColdItem ? base * PLAN.coldMultiplier : base;
}

// Fills the order from the given warehouses, one product at a time in product id order,
// taking from the fastest warehouse first (ties: lower id). Null if the group cannot cover it.
function allocate(
  items: OrderItem[],
  group: Warehouse[],
  products: Map<string, Product>,
  stock: Map<string, number>,
  etas: Etas,
): Allocation | null {
  const fastestFirst = [...group].sort(
    (a, b) => (etas[a.id] as number) - (etas[b.id] as number) || (a.id < b.id ? -1 : 1),
  );
  const allocation: Allocation = {};
  for (const item of items) {
    const product = products.get(item.productId) as Product;
    let need = item.quantity;
    for (const warehouse of fastestFirst) {
      if (need === 0) break;
      const available = canShip(warehouse, product)
        ? (stock.get(`${warehouse.id}|${product.id}`) ?? 0)
        : 0;
      const take = Math.min(need, available);
      if (take > 0) {
        (allocation[warehouse.id] ??= {})[product.id] = take;
        need -= take;
      }
    }
    if (need > 0) return null;
  }
  return allocation;
}

function compareIdLists(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if ((a[i] as string) !== (b[i] as string)) return (a[i] as string) < (b[i] as string) ? -1 : 1;
  }
  return a.length - b.length;
}

// Every valid way to fill the order, best first. A group of warehouses counts only if it covers
// the whole order and every warehouse in it ships something (a smaller group already stands
// for the rest). Best means lowest score; scores equal to 9 decimals are ties, which go to
// fewer shipments and then to the smaller warehouse ids. The caller has already ruled out
// unknown products (findFailure).
export function rankCandidates(items: OrderItem[], snapshot: Snapshot, etas: Etas): Candidate[] {
  const ordered = [...items].sort(byProductId);
  const products = new Map(snapshot.products.map((p) => [p.id, p]));
  const stock = new Map(
    snapshot.stock.map((row) => [`${row.warehouseId}|${row.productId}`, row.quantity]),
  );
  const warehouses = [...snapshot.warehouses].sort((a, b) => (a.id < b.id ? -1 : 1));

  const candidates: Candidate[] = [];
  for (let mask = 1; mask < 1 << warehouses.length; mask++) {
    const group = warehouses.filter((_, i) => mask & (1 << i));
    const allocation = allocate(ordered, group, products, stock, etas);
    if (!allocation || Object.keys(allocation).length !== group.length) continue;

    let cost = 0;
    let slowest = 0;
    for (const warehouse of group) {
      const hasColdItem = Object.keys(allocation[warehouse.id] as object).some(
        (id) => products.get(id)?.requiresColdChain,
      );
      cost += shipmentCost(warehouse, hasColdItem);
      slowest = Math.max(slowest, etas[warehouse.id] as number);
    }
    const score =
      (PLAN.speedWeight * slowest) / PLAN.etaScaleMinutes +
      (PLAN.costWeight * cost) / PLAN.costScale;
    candidates.push({
      warehouseIds: group.map((w) => w.id),
      allocation,
      slowestMinutes: slowest,
      cost: roundTo(cost, PLAN.costDecimals),
      score,
    });
  }

  const tieScore = (c: Candidate) => Number(c.score.toFixed(PLAN.scoreTieDecimals));
  return candidates.sort(
    (a, b) =>
      tieScore(a) - tieScore(b) ||
      a.warehouseIds.length - b.warehouseIds.length ||
      compareIdLists(a.warehouseIds, b.warehouseIds),
  );
}
