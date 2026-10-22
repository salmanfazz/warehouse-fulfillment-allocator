// Every tunable constant lives here, with where it comes from.

// Database client. Source: project rules, Stack section ("small max, 1 to 3", pooler in
// transaction mode so prepared statements are off).
export const DB = {
  poolMax: 3,
  // Not given by the rules; a short, plain limit so a dead database fails fast on serverless.
  connectTimeoutSeconds: 10,
  // An order or a reset waits at most this long for stock row locks, so a stuck lock fails fast.
  lockTimeoutSeconds: 5,
  // Products, warehouses and delivery-time statistics change rarely, so they are kept in memory
  // for five minutes. Stock is never cached.
  referenceCacheMs: 5 * 60 * 1000,
  // "The last 20 orders".
  recentOrdersLimit: 20,
  // Scripts (migrate, seed) need one connection.
  scriptPoolMax: 1,
  // Clients used by the concurrency tests: more than one connection, or the race is hidden.
  testPoolMax: 5,
};

// Planning. The cost rates are placeholders the real operator would replace. The two scales
// are reference values that define what "equal weight" means: 200 minutes of delivery time
// weighs the same as 500 cost units.
export const PLAN = {
  speedWeight: 0.5,
  costWeight: 0.5,
  etaScaleMinutes: 200,
  costScale: 500,
  // Per shipment: base + perKm * distance, times the cold multiplier if it holds a cold-chain item.
  baseCostPerShipment: 50,
  costPerKm: 5,
  coldMultiplier: 1.4,
  // Runner-up plans returned next to the chosen one.
  maxAlternatives: 2,
  // The search tries every group of warehouses (2 to the power of the warehouse count). This keeps
  // it fast and well under the 31-bit mask limit; the demo has 8.
  maxWarehouses: 12,
  // Costs are shown rounded to this many decimals, which removes float noise such as 244.99999999999997.
  costDecimals: 4,
  // Scores that agree to this many decimals count as tied, so float noise cannot decide a ranking.
  scoreTieDecimals: 9,
};

// How the page shows money. The task gives no prices, and the cost rates above are placeholders,
// so this factor is an assumption too: it only makes the numbers read like rupiah. The API, the
// planner and the tests all stay in cost units; only the page multiplies.
export const DISPLAY = {
  rupiahPerCostUnit: 1000,
};

// Delivery time estimate from the delivery history.
export const ETA = {
  // A bucket median is blended with the warehouse median as if it had this many extra records,
  // so one or two records cannot dominate.
  shrinkage: 2,
  // Fewer records than this in a bucket is reported as "limited history".
  limitedHistoryBelow: 2,
  // Peak windows on weekdays, in minutes since midnight WIB, start inclusive and end exclusive:
  // 07:00 to 09:30 and 16:00 to 19:00.
  peakWindows: [
    [7 * 60, 9 * 60 + 30],
    [16 * 60, 19 * 60],
  ] as const,
};

export const TIME = {
  // Asia/Jakarta (WIB) is UTC+7 all year; there is no daylight saving.
  wibOffsetHours: 7,
};

// Request limits. Items per order and quantity per item come from the project rules; the product
// id length is a plain limit that keeps odd input out of error messages.
export const HTTP = {
  maxItems: 5,
  maxQuantity: 10000,
  maxProductIdLength: 32,
  // Product ids are plain codes such as P001. Other characters are refused so that control
  // characters (Postgres rejects a NUL byte in text) never reach the database or an error message.
  productIdPattern: /^[A-Za-z0-9_-]+$/,
  // Unknown request fields are named in the error, but only this many, each cut to this length,
  // so a hostile request cannot make the response much bigger than itself.
  maxUnknownFieldsListed: 5,
  maxEchoedNameLength: 32,
};

// The deployment smoke test (scripts/smoke.ts). The order and the expected split come from the
// baseline seed data and the documented example (45 Hep B vials: W04 has 40, W07 sends the other
// 5). The concurrent pair is two orders of 60 against the 108 shippable vials, so exactly one can
// win. The oversize quantity is more Hep B than exists (158). The timeout is a plain limit so a
// sleeping free-tier function can still wake up. Baseline stock is read from src/db/seed-data.ts.
export const SMOKE = {
  productId: 'P002',
  quantity: 45,
  orderedAt: '2026-10-20T13:00:00+07:00',
  expectedShipments: [
    { warehouseId: 'W04', quantity: 40 },
    { warehouseId: 'W07', quantity: 5 },
  ],
  concurrentQuantity: 60,
  tooManyQuantity: 500,
  requestTimeoutMs: 15000,
};
