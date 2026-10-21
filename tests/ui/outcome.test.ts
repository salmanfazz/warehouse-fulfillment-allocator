import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@/app/ui/api';
import { newRow, type Row } from '@/app/ui/form';
import { outcomeOf } from '@/app/ui/outcome';

const reply = (status: number, data: unknown, info = 'message'): ApiResult<unknown> => ({
  kind: 'envelope',
  status,
  body: { guid: '3f2b8f0e-6f55-4a52-8a8e-0d1f2b3c4d5e', code: status, info, data },
});
const plan = { shipments: [], totalMinutes: 0, totalCost: 0, reasons: [], alternatives: [] };
const rows: Row[] = [newRow(1), newRow(2), newRow(3)];

describe('outcomeOf: a successful answer', () => {
  it('a_200_preview_shows_the_plan_and_leaves_the_stock_alone', () => {
    const o = outcomeOf('preview', reply(200, plan), rows, [1]);
    expect(o.result).toMatchObject({ kind: 'plan', placed: false });
    expect(o.refreshStock).toBe(false);
  });

  it('a_201_place_shows_a_placed_order_and_refreshes_the_stock', () => {
    const o = outcomeOf('place', reply(201, { orderId: 'x', ...plan }), rows, [1]);
    expect(o.result).toMatchObject({ kind: 'plan', placed: true });
    expect(o.refreshStock).toBe(true);
  });

  it('a_reset_says_so_and_refreshes_the_stock', () => {
    const o = outcomeOf('reset', reply(200, null), rows, []);
    expect(o.result).toEqual({ kind: 'reset' });
    expect(o.refreshStock).toBe(true);
  });

  it('a_200_whose_data_is_not_a_plan_is_reported_as_a_failure_instead_of_crashing_the_page', () => {
    for (const data of [null, 'oops', {}, { shipments: 'no' }]) {
      const o = outcomeOf('place', reply(200, data), rows, [1]);
      expect(o.result?.kind).toBe('failed');
      expect(o.refreshStock).toBe(true); // a place that answered strangely may still have written
    }
  });
});

describe('outcomeOf: a rejected order (422)', () => {
  const rejection = {
    reason: 'INSUFFICIENT_STOCK',
    shortfalls: [{ productId: 'P001', requested: 5000, available: 1100 }],
  };

  it('is_shown_with_its_shortfalls', () => {
    const o = outcomeOf('preview', reply(422, rejection, 'Not enough stock'), rows, [1]);
    expect(o.result).toMatchObject({
      kind: 'rejected',
      info: 'Not enough stock',
      reason: 'INSUFFICIENT_STOCK',
      shortfalls: rejection.shortfalls,
    });
  });

  it('refreshes_the_stock_for_a_place_only', () => {
    expect(outcomeOf('place', reply(422, rejection), rows, [1]).refreshStock).toBe(true);
    expect(outcomeOf('preview', reply(422, rejection), rows, [1]).refreshStock).toBe(false);
  });

  it('a_422_without_the_documented_data_is_a_failure_not_a_crash', () => {
    for (const data of [null, {}, 'x']) {
      expect(outcomeOf('place', reply(422, data, 'Nope'), rows, [1]).result?.kind).toBe('failed');
    }
  });
});

describe('outcomeOf: invalid input (400)', () => {
  const errors = [{ field: 'items[1].quantity', message: 'quantity must be at most 10000' }];

  it('puts_the_message_on_the_row_that_was_sent_not_on_the_server_position', () => {
    // row 1 was empty and skipped, so the server's items[1] is the form's row 3
    const o = outcomeOf(
      'preview',
      reply(400, { reason: 'VALIDATION_ERROR', errors }),
      rows,
      [2, 3],
    );
    expect(o.rowErrors).toEqual({ 3: { quantity: 'quantity must be at most 10000' } });
    expect(o.result).toMatchObject({
      kind: 'invalid',
      lines: ['Item 3, quantity: quantity must be at most 10000'],
    });
    expect(o.refreshStock).toBe(false);
  });

  it('keeps_messages_that_belong_to_no_row_as_plain_lines', () => {
    const general = [{ field: 'orderedAt', message: 'orderedAt must include an offset' }];
    const o = outcomeOf('place', reply(400, { errors: general }), rows, [1]);
    expect(o.result).toMatchObject({
      kind: 'invalid',
      lines: ['orderedAt must include an offset'],
    });
  });

  it('a_400_without_errors_still_shows_the_info', () => {
    const o = outcomeOf('place', reply(400, null, 'Bad body'), rows, [1]);
    expect(o.result).toEqual({ kind: 'invalid', info: 'Bad body', lines: [] });
  });

  it('a_400_on_reset_is_just_a_failure', () => {
    expect(outcomeOf('reset', reply(400, null), rows, []).result?.kind).toBe('failed');
  });
});

describe('outcomeOf: everything else', () => {
  it('a_5xx_on_place_says_the_order_may_have_been_placed_and_refreshes_the_stock', () => {
    const o = outcomeOf('place', reply(503, null, 'Service unavailable'), rows, [1]);
    expect(o.result).toEqual({
      kind: 'failed',
      message:
        'Service unavailable. The order may have been placed; check the stock before trying again.',
    });
    expect(o.refreshStock).toBe(true);
  });

  it('a_failed_preview_does_not_refresh_the_stock', () => {
    const o = outcomeOf('preview', reply(500, null, 'Oops'), rows, [1]);
    expect(o.result).toEqual({ kind: 'failed', message: 'Oops. Nothing was reserved.' });
    expect(o.refreshStock).toBe(false);
  });

  it('no_answer_and_a_non_envelope_answer_refresh_the_stock_for_place_and_reset', () => {
    expect(outcomeOf('place', { kind: 'network' }, rows, [1]).refreshStock).toBe(true);
    expect(outcomeOf('reset', { kind: 'unexpected', status: 502 }, rows, []).refreshStock).toBe(
      true,
    );
    expect(outcomeOf('preview', { kind: 'network' }, rows, [1]).refreshStock).toBe(false);
  });
});
