import type { OrderItem, OrderPlan, Product, Shortfall } from '@/domain/types';

export type { Product };

// A warehouse as GET /api/v1/warehouses returns it.
export type WarehouseData = {
  id: string;
  city: string;
  distanceKm: number;
  hasColdStorage: boolean;
  hasRefrigeratedVehicle: boolean;
  stock: Record<string, number>;
};

// One line of GET /api/v1/orders (the last 20, newest first).
export type OrderSummaryData = {
  orderId: string;
  createdAt: string;
  orderedAt: string;
  items: OrderItem[];
  warehouseIds: string[];
  totalMinutes: number;
  totalCost: number;
};

// An order plan; a placed order also has its id.
export type PlanData = OrderPlan & { orderId?: string };

// What the result panel shows. One at a time.
export type ResultState =
  | { kind: 'plan'; placed: boolean; plan: PlanData }
  | { kind: 'rejected'; placed: boolean; info: string; reason: string; shortfalls: Shortfall[] }
  | { kind: 'invalid'; info: string; lines: string[] }
  | { kind: 'failed'; message: string }
  | { kind: 'reset' }
  | null;
