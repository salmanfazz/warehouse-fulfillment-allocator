// A warehouse as the stock table needs it: its id and how much of each product it holds.
export type WarehouseView = { id: string; stock: Record<string, number> };

// What changed between two views of the stock, as "W04/P002" -> signed difference. Only the last
// refresh counts (the caller passes the view it showed before), and the first load has nothing
// to compare with, so it reports nothing.
export function stockChanges(
  previous: WarehouseView[] | null,
  next: WarehouseView[],
): Record<string, number> {
  const changes: Record<string, number> = {};
  if (!previous) return changes;
  const before = new Map(previous.map((w) => [w.id, w.stock]));
  for (const warehouse of next) {
    const old = before.get(warehouse.id);
    if (!old) continue; // a warehouse that was not there before has nothing to compare with
    for (const [productId, quantity] of Object.entries(warehouse.stock)) {
      const difference = quantity - (old[productId] ?? 0);
      if (difference !== 0) changes[`${warehouse.id}/${productId}`] = difference;
    }
  }
  return changes;
}
