import type { JSONValue, Sql } from 'postgres';
import { DB } from '@/config';
import { BASELINE_STOCK } from './seed-data';

// Clears all orders and puts stock back to the baseline, in one transaction.
//
// All stock rows are locked first, in the same order orders lock them (warehouse, then product),
// so a reset and an order can wait for each other but never deadlock. The baseline rows are then
// updated IN PLACE (upsert), never deleted and re-inserted: an order waiting on these locks wakes
// up, re-reads the row it was waiting for and sees the restored quantity. If the rows were
// deleted and re-created it would find nothing and wrongly report that there is no stock.
export async function resetAll(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local lock_timeout = '${DB.lockTimeoutSeconds}s'`);
    await tx`select 1 from stock order by warehouse_id, product_id for update`;
    await tx`delete from orders`;
    await tx`
      insert into stock ${tx(BASELINE_STOCK)}
      on conflict (warehouse_id, product_id) do update set quantity = excluded.quantity`;
    await tx`
      delete from stock s
      where not exists (
        select 1 from jsonb_to_recordset(${tx.json(BASELINE_STOCK as unknown as JSONValue)}::jsonb)
          as b(warehouse_id text, product_id text, quantity int)
        where b.warehouse_id = s.warehouse_id and b.product_id = s.product_id)`;
  });
}
