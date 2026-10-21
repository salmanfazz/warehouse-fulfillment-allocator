import { describe, expect, it } from 'vitest';
import { stockChanges, type WarehouseView } from '@/app/ui/stock';

const w = (id: string, stock: Record<string, number>): WarehouseView => ({ id, stock });
const baseline = [w('W04', { P002: 40, P004: 25 }), w('W07', { P002: 8, P004: 10 })];

describe('stockChanges', () => {
  it('first_load_has_no_changes', () => {
    expect(stockChanges(null, baseline)).toEqual({});
  });

  it('decrease_after_a_place', () => {
    const after = [w('W04', { P002: 0, P004: 25 }), w('W07', { P002: 3, P004: 10 })];
    expect(stockChanges(baseline, after)).toEqual({ 'W04/P002': -40, 'W07/P002': -5 });
  });

  it('increase_after_a_reset', () => {
    const depleted = [w('W04', { P002: 0, P004: 25 }), w('W07', { P002: 3, P004: 10 })];
    expect(stockChanges(depleted, baseline)).toEqual({ 'W04/P002': 40, 'W07/P002': 5 });
  });

  it('unchanged_cells_have_no_entry', () => {
    expect(stockChanges(baseline, baseline)).toEqual({});
  });

  it('a_new_refresh_replaces_the_previous_changes', () => {
    const after = [w('W04', { P002: 0, P004: 25 }), w('W07', { P002: 8, P004: 10 })];
    const first = stockChanges(baseline, after);
    expect(first).toEqual({ 'W04/P002': -40 });
    // refreshing again with nothing new: the earlier change is not carried over
    expect(stockChanges(after, after)).toEqual({});
  });

  it('new_or_missing_warehouses_and_products_do_not_crash', () => {
    const next = [w('W04', { P002: 40, P009: 5 }), w('W99', { P002: 1 })];
    // a product that is not listed any more is not reported; a brand new warehouse has nothing to compare with
    expect(stockChanges(baseline, next)).toEqual({ 'W04/P009': 5 });
  });
});
