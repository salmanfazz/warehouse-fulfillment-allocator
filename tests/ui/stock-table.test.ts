import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StockTable } from '@/app/ui/StockTable';
import type { Product, WarehouseData } from '@/app/ui/types';

const warehouse: WarehouseData = {
  id: 'W01',
  city: 'Surabaya',
  distanceKm: 5,
  hasColdStorage: false,
  hasRefrigeratedVehicle: false,
  stock: { P001: 200 },
};
const product: Product = {
  id: 'P001',
  name: 'Surgical Gloves (Box of 100)',
  category: 'Medical Supplies',
  requiresColdChain: false,
};
const render = (over: Partial<Parameters<typeof StockTable>[0]>) =>
  renderToStaticMarkup(
    createElement(StockTable, {
      warehouses: null,
      products: null,
      changes: {},
      version: 0,
      loadError: null,
      notice: null,
      busy: false,
      onRefresh: () => {},
      ...over,
    }),
  );

describe('StockTable load states', () => {
  it('shows_a_skeleton_while_loading', () => {
    expect(render({})).toContain('Loading stock');
  });

  it('shows_the_error_and_a_retry_button_when_nothing_loaded', () => {
    const html = render({ loadError: 'Could not load the page data.' });
    expect(html).toContain('Could not load the page data.');
    expect(html).toContain('Retry');
  });

  it('shows_the_error_and_a_retry_button_when_stock_loaded_but_products_did_not', () => {
    const html = render({ warehouses: [warehouse], loadError: 'Could not load the page data.' });
    expect(html).toContain('Could not load the page data.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Loading stock');
  });

  it('shows_the_table_when_both_loaded', () => {
    const html = render({ warehouses: [warehouse], products: [product] });
    expect(html).toContain('Surgical Gloves');
    expect(html).not.toContain('Retry');
  });
});
