import type { JSONValue, Sql, TransactionSql } from 'postgres';
import { DB } from '@/config';
import { planOrder } from '@/domain/plan';
import type { Failure, OrderInput, OrderPlan, PlanOutcome, StockRow } from '@/domain/types';
import { toStockRow } from './mappers';
import { getReference } from './reference';

export type PlacedOrder = OrderPlan & { orderId: string };
// A client or a transaction handle: both run the same queries.
export type Runner = Sql | TransactionSql;
// postgres.js types a transaction handle apart from the client although it runs the same queries.
const queries = (run: Runner) => run as Sql;

export type PlaceOutcome = { ok: true; order: PlacedOrder } | { ok: false; failure: Failure };

// Stock of the given products. Rows always come back sorted by warehouse and then product.
// With `lock`, each row is locked FOR UPDATE in that same order. Every transaction that locks
// stock rows (an order, or the reset, which locks all of them) uses this one order, so two of
// them can only ever wait for each other in one direction and no waiting cycle can form.
export async function readStock(
  run: Runner,
  productIds: string[],
  lock: boolean,
): Promise<StockRow[]> {
  const q = queries(run);
  const rows = lock
    ? await q`
        select warehouse_id, product_id, quantity from stock
        where product_id = any(${productIds})
        order by warehouse_id, product_id
        for update`
    : await q`
        select warehouse_id, product_id, quantity from stock
        where product_id = any(${productIds})
        order by warehouse_id, product_id`;
  return rows.map(toStockRow);
}

// Plans an order on current stock and writes nothing.
export async function previewOrder(sql: Sql, input: OrderInput): Promise<PlanOutcome> {
  const reference = await getReference(sql);
  const stock = await readStock(sql, productIdsOf(input), false);
  return planOrder(input, { ...reference, stock });
}

class Rejected extends Error {
  constructor(readonly failure: Failure) {
    super(failure.info);
  }
}

// Plans an order on locked stock and, if it fits, reserves the stock and stores the order, all in
// one transaction. A shortfall rolls everything back. Malformed input (a RangeError from the
// domain) and database errors, including a lock timeout (SQLSTATE 55P03), are thrown.
export async function placeOrder(sql: Sql, input: OrderInput): Promise<PlaceOutcome> {
  const reference = await getReference(sql); // before the transaction, so locks are held briefly
  try {
    const order = await sql.begin(async (tx) => {
      await tx.unsafe(`set local lock_timeout = '${DB.lockTimeoutSeconds}s'`);
      const stock = await readStock(tx, productIdsOf(input), true);
      const outcome = planOrder(input, { ...reference, stock });
      if (!outcome.ok) throw new Rejected(outcome.failure);

      const placed: PlacedOrder = { orderId: crypto.randomUUID(), ...outcome.plan };
      await subtractStock(tx, placed);
      await tx`
        insert into orders (id, ordered_at, items, plan)
        values (${placed.orderId}, ${placed.orderedAt}, ${tx.json(input.items as unknown as JSONValue)},
                ${tx.json(placed as unknown as JSONValue)})`;
      return placed;
    });
    return { ok: true, order };
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, failure: err.failure };
    throw err;
  }
}

function productIdsOf(input: OrderInput): string[] {
  return input.items.map((item) => item.productId);
}

// One statement for all shipment lines. Every row was locked above, and each line must hit
// exactly one row. The CHECK (quantity >= 0) on the table is the last safety net.
async function subtractStock(run: Runner, order: PlacedOrder): Promise<void> {
  const tx = queries(run);
  const lines = order.shipments.flatMap((shipment) =>
    shipment.items.map((item) => ({
      warehouse_id: shipment.warehouseId,
      product_id: item.productId,
      quantity: item.quantity,
    })),
  );
  const updated = await tx`
    update stock set quantity = stock.quantity - d.quantity
    from jsonb_to_recordset(${tx.json(lines)}::jsonb) as d(warehouse_id text, product_id text, quantity int)
    where stock.warehouse_id = d.warehouse_id and stock.product_id = d.product_id`;
  if (updated.count !== lines.length) {
    throw new Error(`Expected to update ${lines.length} stock rows, updated ${updated.count}`);
  }
}
