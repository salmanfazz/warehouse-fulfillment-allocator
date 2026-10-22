import { DISPLAY, PLAN } from '@/config';
import type { OrderItem, Shipment } from '@/domain/types';

const numbers = new Intl.NumberFormat('en-US'); // fixed locale: the same text for every visitor

export const formatNumber = (n: number): string => numbers.format(n);

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

// Cost units from the API shown as rupiah, e.g. 665 -> "Rp 665.000". The text uses a plain space.
export const formatRupiah = (costUnits: number): string =>
  rupiah.format(costUnits * DISPLAY.rupiahPerCostUnit).replace(/\u00a0/g, ' ');

// The planner writes its reasons in cost units ("cost 355", "costs 100 more (455 vs 355)"); the page
// shows rupiah, so those figures are rewritten here. Only the cost phrases are touched, and a test
// runs the real planner over the golden cases to catch the wording drifting away from these patterns.
export const reasonInRupiah = (sentence: string): string =>
  sentence
    .replace(
      /\b(costs?) (\d+(?:\.\d+)?)/g,
      (_m, word: string, n: string) => `${word} ${formatRupiah(Number(n))}`,
    )
    .replace(
      /\((\d+(?:\.\d+)?) vs (\d+(?:\.\d+)?)\)/g,
      (_m, a: string, b: string) => `(${formatRupiah(Number(a))} vs ${formatRupiah(Number(b))})`,
    );

export type CostBreakdown = {
  fixed: number;
  perKm: number;
  distancePart: number; // perKm times the distance
  subtotal: number; // fixed + distancePart
  multiplier: number | null; // the cold multiplier, or null for a standard vehicle
  total: number;
};

// The shipment cost rule from the planner, split into the parts a reader can follow. Uses the same
// PLAN constants; a test checks the total against the planner's own function.
export function costBreakdown(distanceKm: number, vehicle: Shipment['vehicle']): CostBreakdown {
  const fixed = PLAN.baseCostPerShipment;
  const distancePart = PLAN.costPerKm * distanceKm;
  const subtotal = fixed + distancePart;
  const multiplier = vehicle === 'refrigerated' ? PLAN.coldMultiplier : null;
  return {
    fixed,
    perKm: PLAN.costPerKm,
    distancePart,
    subtotal,
    multiplier,
    total: multiplier === null ? subtotal : subtotal * multiplier,
  };
}

// One shipment's cost worked out in the order a reader follows it: the part in parentheses first,
// then the multiplier. A standard vehicle multiplies by 1, so every line has the same shape.
export function breakdownText(distanceKm: number, vehicle: Shipment['vehicle']): string {
  const b = costBreakdown(distanceKm, vehicle);
  const inside = `(${formatRupiah(b.fixed)} + ${formatNumber(distanceKm)} km × ${formatRupiah(b.perKm)})`;
  if (b.multiplier === null) return `${inside} × 1 = ${formatRupiah(b.total)}`;
  return `${inside} × ${b.multiplier} = ${formatRupiah(b.subtotal)} × ${b.multiplier} = ${formatRupiah(b.total)}`;
}

// "−40" with a real minus sign, "+5"
export const formatChange = (n: number): string =>
  n < 0 ? `−${formatNumber(-n)}` : `+${formatNumber(n)}`;

// "2026-10-19T08:00:00+07:00" -> "2026-10-19 08:00 WIB". Anything else keeps its offset.
export const formatWib = (iso: string): string =>
  /:00\+07:00$/.test(iso) ? `${iso.replace('T', ' ').replace(/:00\+07:00$/, '')} WIB` : iso;

export function itemsText(items: OrderItem[], nameOf: (productId: string) => string): string {
  return items.map((i) => `${nameOf(i.productId)} ×${formatNumber(i.quantity)}`).join(', ');
}

// The stable reason codes of a rejected order, in words.
export function reasonText(reason: string): string {
  switch (reason) {
    case 'INSUFFICIENT_STOCK':
      return 'Not enough stock';
    case 'COLD_CHAIN_UNAVAILABLE':
      return 'The stock exists but cannot be shipped with cold chain';
    case 'UNKNOWN_PRODUCT':
      return 'The product is not in the catalogue';
    default:
      return reason;
  }
}

type ColdFlags = { hasColdStorage: boolean; hasRefrigeratedVehicle: boolean };

// A cold-chain product ships only from a warehouse with both cold storage and a refrigerated van.
// This mirrors what the API reports about each warehouse; the page never decides it by id.
export const canShipCold = (w: ColdFlags): boolean => w.hasColdStorage && w.hasRefrigeratedVehicle;

export function coldChainLabel(w: ColdFlags): string {
  if (canShipCold(w)) return 'storage and van';
  if (w.hasColdStorage) return 'storage only';
  if (w.hasRefrigeratedVehicle) return 'van only';
  return 'none';
}

export type Action = 'preview' | 'place' | 'reset';
export type Failure =
  | { kind: 'network' }
  | { kind: 'unexpected'; status: number }
  | { kind: 'envelope'; status: number; info: string };

// What to tell the user when a request did not succeed and was not a rejected order. A preview
// never writes, and a 4xx answer means the request was refused before any write, so "nothing was
// reserved" is true. A 5xx can come from a connection that dropped while the commit was in flight,
// and with no usable answer at all nothing is known: for a place or reset the message says so.
export function failureMessage(action: Action, failure: Failure): string {
  const sure = action === 'reset' ? 'Nothing was changed.' : 'Nothing was reserved.';
  const unsure =
    action === 'place'
      ? 'The order may have been placed; check the stock before trying again.'
      : action === 'reset'
        ? 'The reset may not have happened; refresh the stock to check.'
        : sure;
  if (failure.kind === 'network') return `Could not reach the server. ${unsure}`;
  if (failure.kind === 'unexpected') {
    return `The server did not answer properly (status ${failure.status}). ${unsure}`;
  }
  return `${failure.info.replace(/\.$/, '')}. ${failure.status < 500 ? sure : unsure}`;
}
