import { describe, expect, it } from 'vitest';
import {
  canShipCold,
  coldChainLabel,
  failureMessage,
  formatChange,
  formatNumber,
  itemsText,
  reasonText,
} from '@/app/ui/format';

describe('numbers', () => {
  it('thousands_separators', () => {
    expect(formatNumber(1120)).toBe('1,120');
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(244.5)).toBe('244.5');
    expect(formatNumber(0)).toBe('0');
  });

  it('minus_sign_and_plus_sign', () => {
    expect(formatChange(-40)).toBe('−40');
    expect(formatChange(5)).toBe('+5');
    expect(formatChange(-1120)).toBe('−1,120');
  });
});

describe('text', () => {
  const names: Record<string, string> = {
    P002: 'Vaccine - Hepatitis B (10-dose vial)',
    P001: 'Surgical Gloves (Box of 100)',
  };
  const nameOf = (id: string) => names[id] ?? id;

  it('items_text_uses_full_names_and_falls_back_to_the_id', () => {
    expect(itemsText([{ productId: 'P002', quantity: 40 }], nameOf)).toBe(
      'Vaccine - Hepatitis B (10-dose vial) ×40',
    );
    expect(
      itemsText(
        [
          { productId: 'P001', quantity: 1200 },
          { productId: 'P999', quantity: 2 },
        ],
        nameOf,
      ),
    ).toBe('Surgical Gloves (Box of 100) ×1,200, P999 ×2');
  });

  it('reason_text_for_each_reason', () => {
    expect(reasonText('INSUFFICIENT_STOCK')).toBe('Not enough stock');
    expect(reasonText('COLD_CHAIN_UNAVAILABLE')).toBe(
      'The stock exists but cannot be shipped with cold chain',
    );
    expect(reasonText('UNKNOWN_PRODUCT')).toBe('The product is not in the catalogue');
    expect(reasonText('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('cold chain', () => {
  const both = { hasColdStorage: true, hasRefrigeratedVehicle: true };
  const storageOnly = { hasColdStorage: true, hasRefrigeratedVehicle: false };
  const vanOnly = { hasColdStorage: false, hasRefrigeratedVehicle: true };
  const neither = { hasColdStorage: false, hasRefrigeratedVehicle: false };

  it('cold_chain_label', () => {
    expect(coldChainLabel(both)).toBe('storage and van');
    expect(coldChainLabel(storageOnly)).toBe('storage only');
    expect(coldChainLabel(vanOnly)).toBe('van only');
    expect(coldChainLabel(neither)).toBe('none');
  });

  it('can_ship_cold_needs_both_flags', () => {
    expect(canShipCold(both)).toBe(true);
    expect(canShipCold(storageOnly)).toBe(false);
    expect(canShipCold(vanOnly)).toBe(false);
    expect(canShipCold(neither)).toBe(false);
  });
});

describe('failureMessage', () => {
  const envelope = (status: number, info: string) => ({ kind: 'envelope' as const, status, info });

  it('a_server_error_that_answered_means_nothing_happened_because_orders_are_atomic', () => {
    expect(failureMessage('place', envelope(503, 'Database unavailable'))).toBe(
      'Database unavailable. Nothing was reserved.',
    );
    expect(failureMessage('preview', envelope(500, 'Something went wrong'))).toBe(
      'Something went wrong. Nothing was reserved.',
    );
    expect(failureMessage('reset', envelope(503, 'Database unavailable'))).toBe(
      'Database unavailable. Nothing was changed.',
    );
  });

  it('no_answer_at_all_is_honest_about_what_is_unknown', () => {
    expect(failureMessage('place', { kind: 'network' })).toBe(
      'Could not reach the server. The order may have been placed; check the stock before trying again.',
    );
    expect(failureMessage('reset', { kind: 'network' })).toBe(
      'Could not reach the server. The reset may not have happened; refresh the stock to check.',
    );
    expect(failureMessage('preview', { kind: 'network' })).toBe(
      'Could not reach the server. Nothing was reserved.',
    );
  });

  it('an_answer_that_is_not_the_envelope_names_the_status', () => {
    expect(failureMessage('place', { kind: 'unexpected', status: 502 })).toBe(
      'The server did not answer properly (status 502). The order may have been placed; check the stock before trying again.',
    );
    expect(failureMessage('preview', { kind: 'unexpected', status: 200 })).toBe(
      'The server did not answer properly (status 200). Nothing was reserved.',
    );
  });

  it('an_info_that_already_ends_with_a_full_stop_is_not_doubled', () => {
    expect(failureMessage('place', envelope(500, 'Something went wrong.'))).toBe(
      'Something went wrong. Nothing was reserved.',
    );
  });
});
