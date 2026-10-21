import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDeliveryCsv, seed } from '@/db/seed';
import { testSql } from './helpers';

const sql = testSql();
afterAll(() => sql.end());

async function count(table: string) {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
  return row?.n;
}

async function counts() {
  return [
    await count('products'),
    await count('warehouses'),
    await count('stock'),
    await count('delivery_records'),
  ];
}

describe('seed data', () => {
  it('has_5_products_8_warehouses_23_stock_rows_and_38_delivery_records', async () => {
    expect(await counts()).toEqual([5, 8, 23, 38]);
  });

  it('a_second_seed_run_keeps_the_same_counts', async () => {
    await seed(sql);
    expect(await counts()).toEqual([5, 8, 23, 38]);
  });

  it('a_seed_run_does_not_overwrite_changed_stock', async () => {
    await sql`update stock set quantity = 1 where warehouse_id = 'W02' and product_id = 'P002'`;
    try {
      await seed(sql);
      const [row] =
        await sql`select quantity from stock where warehouse_id = 'W02' and product_id = 'P002'`;
      expect(row?.quantity).toBe(1);
    } finally {
      await sql`update stock set quantity = 30 where warehouse_id = 'W02' and product_id = 'P002'`;
    }
  });

  it('a_seed_run_restores_edited_reference_data', async () => {
    await sql`update products set name = 'edited' where id = 'P001'`;
    await sql`update warehouses set distance_km = 999 where id = 'W01'`;
    await sql`update delivery_records set duration_min = 999 where id = 'DL001'`;
    await seed(sql);
    const [product] = await sql`select name from products where id = 'P001'`;
    const [warehouse] = await sql`select distance_km from warehouses where id = 'W01'`;
    const [record] = await sql`select duration_min from delivery_records where id = 'DL001'`;
    expect(product?.name).toBe('Surgical Gloves (Box of 100)');
    expect(warehouse?.distance_km).toBe(5);
    expect(record?.duration_min).toBe(50);
  });

  it('cold_chain_flags_match_the_seed_tables', async () => {
    const products = await sql`select id from products where requires_cold_chain order by id`;
    expect(products.map((r) => r.id)).toEqual(['P002', 'P004']);
    const capable = await sql`
      select id from warehouses where has_cold_storage and has_refrigerated_vehicle order by id`;
    expect(capable.map((r) => r.id)).toEqual(['W04', 'W07', 'W08']);
    const storageOnly = await sql`
      select id from warehouses where has_cold_storage and not has_refrigerated_vehicle order by id`;
    expect(storageOnly.map((r) => r.id)).toEqual(['W02', 'W06']);
  });

  it('shippable_and_network_totals_match_the_seed_tables', async () => {
    const rows = await sql<{ product_id: string; network: number; shippable: number }[]>`
      select s.product_id,
             sum(s.quantity)::int as network,
             coalesce(sum(s.quantity) filter (
               where w.has_cold_storage and w.has_refrigerated_vehicle), 0)::int as shippable
      from stock s join warehouses w on w.id = s.warehouse_id
      where s.product_id in ('P002', 'P004') group by s.product_id order by s.product_id`;
    expect(rows).toEqual([
      { product_id: 'P002', network: 158, shippable: 108 },
      { product_id: 'P004', network: 135, shippable: 85 },
    ]);
  });

  it('delivery_records_match_the_csv_rows', async () => {
    const [row] = await sql`
      select id, warehouse_id, day, to_char(start_time, 'HH24:MI') as start, duration_min
      from delivery_records where id = 'DL001'`;
    expect(row).toEqual({
      id: 'DL001',
      warehouse_id: 'W01',
      day: 'Mon',
      start: '08:00',
      duration_min: 50,
    });
  });

  it('the_notes_column_is_not_loaded', async () => {
    const columns = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'delivery_records'`;
    expect(columns.map((c) => c.column_name)).not.toContain('notes');
  });
});

describe('parseDeliveryCsv', () => {
  it('reads_the_real_file_into_38_rows_with_numbers', async () => {
    const rows = parseDeliveryCsv(await readFile('db/seeds/delivery_records.csv', 'utf8'));
    expect(rows).toHaveLength(38);
    expect(rows[0]).toEqual({
      id: 'DL001',
      warehouse_id: 'W01',
      day: 'Mon',
      start_time: '08:00',
      duration_min: 50,
    });
  });

  it('rejects_a_row_without_six_fields', () => {
    const header = 'delivery_id,warehouse_id,day,start_time,duration_min,notes';
    expect(() => parseDeliveryCsv(`${header}\nDL001,W01,Mon,08:00,50`)).toThrow(/line 2.*6 fields/);
  });

  it('rejects_an_unexpected_header', () => {
    expect(() => parseDeliveryCsv('a,b,c\nx,y,z')).toThrow(/header/);
  });

  it('rejects_a_duration_that_is_not_a_whole_number', () => {
    const header = 'delivery_id,warehouse_id,day,start_time,duration_min,notes';
    expect(() => parseDeliveryCsv(`${header}\nDL001,W01,Mon,08:00,fifty,`)).toThrow(/duration/);
  });
});
