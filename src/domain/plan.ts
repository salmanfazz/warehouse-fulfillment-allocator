import type { FailureFacts, OrderItem, Product, ShortfallFact, Snapshot, Warehouse } from './types';

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
