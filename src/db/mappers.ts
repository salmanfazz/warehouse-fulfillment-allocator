import type { DeliveryRecord, Day, Product, StockRow, Warehouse } from '@/domain/types';

type Row = Record<string, unknown>;

// postgres.js hands back whatever the column type gives: integer is a number, but count(),
// sum(), bigint and numeric come back as strings, and adding strings concatenates them.
// So every field is checked, and a mismatch names the column (and the type, never the value).
function describe(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new TypeError(`Column ${column} must be text, got ${describe(value)}`);
  return value;
}

function whole(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Column ${column} must be a whole number, got ${describe(value)}`);
  }
  return value;
}

function flag(row: Row, column: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new TypeError(`Column ${column} must be true or false, got ${describe(value)}`);
  return value;
}

export function toProduct(row: Row): Product {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    category: text(row, 'category'),
    requiresColdChain: flag(row, 'requires_cold_chain'),
  };
}

export function toWarehouse(row: Row): Warehouse {
  return {
    id: text(row, 'id'),
    city: text(row, 'city'),
    distanceKm: whole(row, 'distance_km'),
    hasColdStorage: flag(row, 'has_cold_storage'),
    hasRefrigeratedVehicle: flag(row, 'has_refrigerated_vehicle'),
  };
}

export function toStockRow(row: Row): StockRow {
  return {
    warehouseId: text(row, 'warehouse_id'),
    productId: text(row, 'product_id'),
    quantity: whole(row, 'quantity'),
  };
}

// start_time arrives as "HH:MM:SS"; the domain accepts that form.
export function toDeliveryRecord(row: Row): DeliveryRecord {
  return {
    warehouseId: text(row, 'warehouse_id'),
    day: text(row, 'day') as Day,
    startTime: text(row, 'start_time'),
    durationMin: whole(row, 'duration_min'),
  };
}
