import type { OrderItem } from '@/domain/types';

const numbers = new Intl.NumberFormat('en-US'); // fixed locale: the same text for every visitor

export const formatNumber = (n: number): string => numbers.format(n);

// "−40" with a real minus sign, "+5"
export const formatChange = (n: number): string =>
  n < 0 ? `−${formatNumber(-n)}` : `+${formatNumber(n)}`;

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
