import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from 'postgres';
import { BASELINE_STOCK, PRODUCTS, WAREHOUSES } from './seed-data';

const DELIVERY_CSV = path.join(process.cwd(), 'db', 'seeds', 'delivery_records.csv');
const CSV_HEADER = 'delivery_id,warehouse_id,day,start_time,duration_min,notes';

export type DeliveryRow = {
  id: string;
  warehouse_id: string;
  day: string;
  start_time: string;
  duration_min: number;
};

// The file has six plain columns and no quoted commas. The last column (notes) is not loaded.
export function parseDeliveryCsv(text: string): DeliveryRow[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (header?.trim() !== CSV_HEADER) throw new Error(`Unexpected CSV header: ${header}`);
  return lines.map((line, i) => {
    const fields = line.split(',');
    if (fields.length !== 6) {
      throw new Error(`CSV line ${i + 2}: expected 6 fields, found ${fields.length}`);
    }
    const [id, warehouse_id, day, start_time, duration] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (!/^\d+$/.test(duration))
      throw new Error(`CSV line ${i + 2}: duration is not a whole number`);
    return { id, warehouse_id, day, start_time, duration_min: Number(duration) };
  });
}

// Safe to run any number of times: reference data is corrected, delivery records are
// upserted, and stock rows that already exist are left alone (reset restores the baseline).
export async function seed(sql: Sql, csvPath = DELIVERY_CSV): Promise<void> {
  const deliveries = parseDeliveryCsv(await readFile(csvPath, 'utf8'));
  await sql.begin(async (tx) => {
    await tx`
      insert into products ${tx(PRODUCTS)}
      on conflict (id) do update set name = excluded.name, category = excluded.category,
        requires_cold_chain = excluded.requires_cold_chain`;
    await tx`
      insert into warehouses ${tx(WAREHOUSES)}
      on conflict (id) do update set city = excluded.city, distance_km = excluded.distance_km,
        has_cold_storage = excluded.has_cold_storage,
        has_refrigerated_vehicle = excluded.has_refrigerated_vehicle`;
    await tx`
      insert into stock ${tx(BASELINE_STOCK)}
      on conflict (warehouse_id, product_id) do nothing`;
    await tx`
      insert into delivery_records ${tx(deliveries)}
      on conflict (id) do update set warehouse_id = excluded.warehouse_id, day = excluded.day,
        start_time = excluded.start_time, duration_min = excluded.duration_min`;
  });
}
