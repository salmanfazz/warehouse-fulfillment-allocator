// Plain data shapes for the pure domain. Nothing here knows about the database or HTTP.

export type Bucket = 'peak' | 'off_peak' | 'weekend';
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type Product = { id: string; name: string; category: string; requiresColdChain: boolean };
export type Warehouse = {
  id: string;
  city: string;
  distanceKm: number;
  hasColdStorage: boolean;
  hasRefrigeratedVehicle: boolean;
};
export type StockRow = { warehouseId: string; productId: string; quantity: number };
// startTime is "HH:MM" or "HH:MM:SS", in WIB.
export type DeliveryRecord = {
  warehouseId: string;
  day: Day;
  startTime: string;
  durationMin: number;
};

export type BucketStats = { n: number; bucketMedian: number | null; estimate: number };
export type WarehouseEta = {
  warehouseMedian: number;
  count: number;
  buckets: Record<Bucket, BucketStats>;
};
export type EtaStats = Record<string, WarehouseEta>;

export type OrderItem = { productId: string; quantity: number };
// orderedAt is ISO 8601 with an offset.
export type OrderInput = { items: OrderItem[]; orderedAt: string };
export type Snapshot = {
  products: Product[];
  warehouses: Warehouse[];
  stock: StockRow[];
  eta: EtaStats;
};

export type Shortfall = { productId: string; requested: number; available: number };
export type FailureReason = 'UNKNOWN_PRODUCT' | 'INSUFFICIENT_STOCK' | 'COLD_CHAIN_UNAVAILABLE';
// Why a product is short: stock exists but cannot be shipped cold, there is not enough stock,
// or the product id is not in the catalogue.
export type ShortfallCause = 'COLD_CHAIN' | 'STOCK' | 'UNKNOWN';
export type ShortfallFact = Shortfall & { network: number; cause: ShortfallCause };
export type FailureFacts = { reason: FailureReason; shortfalls: ShortfallFact[] };
export type Failure = { reason: FailureReason; info: string; shortfalls: Shortfall[] };

// warehouse id -> product id -> quantity
export type Allocation = Record<string, Record<string, number>>;
export type Candidate = {
  warehouseIds: string[];
  allocation: Allocation;
  slowestMinutes: number;
  cost: number;
  score: number;
};

export type Shipment = {
  warehouseId: string;
  city: string;
  distanceKm: number;
  vehicle: 'standard' | 'refrigerated';
  items: OrderItem[];
  minutes: number;
  cost: number;
};
export type PlanSummary = { warehouseIds: string[]; totalMinutes: number; totalCost: number };
export type OrderPlan = {
  orderedAt: string;
  shipments: Shipment[];
  totalMinutes: number;
  totalCost: number;
  reasons: string[];
  alternatives: PlanSummary[];
};
export type PlanOutcome = { ok: true; plan: OrderPlan } | { ok: false; failure: Failure };
