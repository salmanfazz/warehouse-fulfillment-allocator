import { readFileSync } from 'node:fs';
import { parseDeliveryCsv } from '@/db/seed';
import { BASELINE_STOCK, PRODUCTS, WAREHOUSES } from '@/db/seed-data';
import { buildEtaStats } from '@/domain/eta';
import type { Day, DeliveryRecord, EtaStats, OrderItem, Snapshot } from '@/domain/types';

export function loadDeliveryRecords(): DeliveryRecord[] {
  const text = readFileSync('db/seeds/delivery_records.csv', 'utf8');
  return parseDeliveryCsv(text).map((row) => ({
    warehouseId: row.warehouse_id,
    day: row.day as Day,
    startTime: row.start_time,
    durationMin: row.duration_min,
  }));
}

export function baselineEta(): EtaStats {
  return buildEtaStats(
    loadDeliveryRecords(),
    WAREHOUSES.map((w) => w.id),
  );
}

// The demo catalogue, warehouses and baseline stock, mapped to the domain's camelCase shapes.
export function baselineSnapshot(eta: EtaStats = baselineEta()): Snapshot {
  return {
    products: PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      requiresColdChain: p.requires_cold_chain,
    })),
    warehouses: WAREHOUSES.map((w) => ({
      id: w.id,
      city: w.city,
      distanceKm: w.distance_km,
      hasColdStorage: w.has_cold_storage,
      hasRefrigeratedVehicle: w.has_refrigerated_vehicle,
    })),
    stock: BASELINE_STOCK.map((s) => ({
      warehouseId: s.warehouse_id,
      productId: s.product_id,
      quantity: s.quantity,
    })),
    eta,
  };
}

export function itemsOf(order: Record<string, number>): OrderItem[] {
  return Object.entries(order).map(([productId, quantity]) => ({ productId, quantity }));
}
