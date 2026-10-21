import type { Sql } from 'postgres';
import type { Product, Warehouse } from '@/domain/types';
import { toStockRow } from './mappers';
import { getReference } from './reference';

// A warehouse with what it holds right now: one entry for every product, 0 where it has none.
export type WarehouseWithStock = Warehouse & { stock: Record<string, number> };

// The catalogue changes only when the demo is reseeded, so it comes from the reference cache.
export async function listProducts(sql: Sql): Promise<Product[]> {
  return (await getReference(sql)).products;
}

// Warehouses are cached reference data; stock is read fresh.
export async function listWarehouses(sql: Sql): Promise<WarehouseWithStock[]> {
  const { products, warehouses } = await getReference(sql);
  const rows = (await sql`select warehouse_id, product_id, quantity from stock`).map(toStockRow);
  return warehouses.map((warehouse) => {
    const stock = Object.fromEntries(products.map((p) => [p.id, 0]));
    for (const row of rows) {
      if (row.warehouseId === warehouse.id && row.productId in stock)
        stock[row.productId] = row.quantity;
    }
    return { ...warehouse, stock };
  });
}
