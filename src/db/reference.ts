import type { Sql } from 'postgres';
import { DB } from '@/config';
import { buildEtaStats } from '@/domain/eta';
import type { EtaStats, Product, Warehouse } from '@/domain/types';
import { cached } from './cache';
import { toDeliveryRecord, toProduct, toWarehouse } from './mappers';

// Data that changes only when the demo is reseeded: the catalogue, the warehouses and the
// delivery-time statistics built from the delivery history.
export type Reference = { products: Product[]; warehouses: Warehouse[]; eta: EtaStats };

type Rows = Record<string, unknown>[];

export function buildReference(rows: {
  products: Rows;
  warehouses: Rows;
  deliveries: Rows;
}): Reference {
  const warehouses = rows.warehouses.map(toWarehouse);
  return {
    products: rows.products.map(toProduct),
    warehouses,
    eta: buildEtaStats(
      rows.deliveries.map(toDeliveryRecord),
      warehouses.map((w) => w.id),
    ),
  };
}

async function loadReference(sql: Sql): Promise<Reference> {
  const [products, warehouses, deliveries] = await Promise.all([
    sql`select id, name, category, requires_cold_chain from products order by id`,
    sql`select id, city, distance_km, has_cold_storage, has_refrigerated_vehicle from warehouses order by id`,
    sql`select id, warehouse_id, day, start_time, duration_min from delivery_records order by id`,
  ]);
  return buildReference({ products, warehouses, deliveries });
}

// One cache per client, so a test client and the app client never share data.
const caches = new Map<Sql, ReturnType<typeof cached<Reference>>>();

export function getReference(sql: Sql): Promise<Reference> {
  let cache = caches.get(sql);
  if (!cache) {
    cache = cached(() => loadReference(sql), DB.referenceCacheMs);
    caches.set(sql, cache);
  }
  return cache.get();
}

// For one client, or for all of them when called without one.
export function clearReferenceCache(sql?: Sql): void {
  if (sql) caches.get(sql)?.clear();
  else caches.forEach((cache) => cache.clear());
}
