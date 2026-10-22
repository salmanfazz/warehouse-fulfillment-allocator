import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatWib } from '@/app/ui/format';
import { OrderHistory } from '@/app/ui/OrderHistory';
import type { OrderSummaryData } from '@/app/ui/types';

const names: Record<string, string> = { P002: 'Vaccine - Hepatitis B (10-dose vial)' };
const nameOf = (id: string) => names[id] ?? id;

const order: OrderSummaryData = {
  orderId: '3f2a9c1e-0000-4000-8000-000000000001',
  createdAt: '2026-10-19T08:00:05+07:00',
  orderedAt: '2026-10-19T08:00:00+07:00',
  items: [{ productId: 'P002', quantity: 45 }],
  warehouseIds: ['W04', 'W07'],
  totalMinutes: 68,
  totalCost: 665,
};

const render = (props: { orders: OrderSummaryData[] | null; error?: string | null }) =>
  renderToStaticMarkup(createElement(OrderHistory, { error: null, nameOf, ...props }));

describe('formatWib', () => {
  it('drops_the_seconds_and_offset', () => {
    expect(formatWib('2026-10-19T08:00:00+07:00')).toBe('2026-10-19 08:00 WIB');
  });
});

describe('OrderHistory', () => {
  it('says_it_is_loading_before_the_first_answer', () => {
    expect(render({ orders: null })).toContain('Loading');
  });

  it('says_there_are_no_orders_yet', () => {
    const html = render({ orders: [] });
    expect(html).toContain('No orders yet');
    expect(html).not.toContain('<table');
  });

  it('lists_an_order_with_short_id_rupiah_items_and_warehouses', () => {
    const html = render({ orders: [order] });
    expect(html).toContain('>3f2a9c1e<'); // the visible text is the short id
    expect(html).toContain('title="3f2a9c1e-0000-4000-8000-000000000001"'); // the full id is the tooltip
    expect(html).toContain('2026-10-19 08:00 WIB');
    expect(html).toContain('Vaccine - Hepatitis B (10-dose vial) ×45');
    expect(html).toContain('W04 + W07');
    expect(html).toContain('68');
    expect(html).toContain('Rp 665.000');
  });

  it('keeps_newest_first_as_given', () => {
    const second = { ...order, orderId: 'aaaaaaaa-0000-4000-8000-000000000002' };
    const html = render({ orders: [second, order] });
    expect(html.indexOf('aaaaaaaa')).toBeLessThan(html.indexOf('3f2a9c1e'));
  });

  it('shows_a_notice_when_the_last_refresh_failed', () => {
    const html = render({ orders: [order], error: 'Could not refresh the orders.' });
    expect(html).toContain('Could not refresh the orders.');
    expect(html).toContain('Rp 665.000');
  });
});
