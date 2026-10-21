// Every tunable constant lives here, with where it comes from.

// Database client. Source: project rules, Stack section ("small max, 1 to 3", pooler in
// transaction mode so prepared statements are off).
export const DB = {
  poolMax: 3,
  // Not given by the rules; a short, plain limit so a dead database fails fast on serverless.
  connectTimeoutSeconds: 10,
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
  // Costs are shown rounded to this many decimals, which removes float noise such as 244.99999999999997.
  costDecimals: 4,
  // Scores that agree to this many decimals count as tied, so float noise cannot decide a ranking.
  scoreTieDecimals: 9,
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
