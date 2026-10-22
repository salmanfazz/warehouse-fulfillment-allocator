import { describe, expect, it } from 'vitest';
import {
  buildBody,
  checkRows,
  digitsOnly,
  mapServerErrors,
  newRow,
  takenByOthers,
  type Row,
} from '@/app/ui/form';
import { HTTP } from '@/config';
import { parseOrderRequest } from '@/http/schemas';

const row = (id: number, productId = '', quantity = ''): Row => ({ id, productId, quantity });
const QUANTITY_MESSAGE = 'Enter a whole number from 1 to 10000';

describe('checkRows', () => {
  it('skips_completely_empty_rows', () => {
    const result = checkRows([row(1, 'P001', '5'), row(2), row(3, '', '  ')]);
    expect(result.items).toEqual([{ productId: 'P001', quantity: 5 }]);
    expect(result.sentRowIds).toEqual([1]);
    expect(result.errors).toEqual({});
    expect(result.formError).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('half_filled_rows_get_an_error_on_the_missing_half', () => {
    const { errors, valid } = checkRows([row(1, 'P001', ''), row(2, '', '7')]);
    expect(errors[1]).toEqual({ quantity: QUANTITY_MESSAGE });
    expect(errors[2]).toEqual({ productId: 'Choose a product' });
    expect(valid).toBe(false);
  });

  it('quantity_rules', () => {
    const bad = ['0', '-3', '1.5', '1e3', '10001', 'abc', '+5', '5 0', '٣', '1,000', '0x10'];
    for (const quantity of bad) {
      expect(checkRows([row(1, 'P001', quantity)]).errors[1]?.quantity, quantity).toBe(
        QUANTITY_MESSAGE,
      );
    }
    for (const [quantity, want] of [
      ['1', 1],
      ['10000', 10000],
      [' 5 ', 5],
      ['007', 7],
    ] as const) {
      expect(checkRows([row(1, 'P001', quantity)]).items[0]?.quantity, quantity).toBe(want);
    }
  });

  it('the_limit_in_the_message_comes_from_the_shared_config', () => {
    expect(QUANTITY_MESSAGE).toContain(String(HTTP.maxQuantity));
  });

  it('same_product_twice_is_an_error_on_the_second_row', () => {
    const { errors, items } = checkRows([
      row(1, 'P001', '5'),
      row(2, 'P002', '1'),
      row(3, 'P001', '2'),
    ]);
    expect(errors).toEqual({ 3: { productId: 'This product is already in the order' } });
    expect(items.map((i) => i.productId)).toEqual(['P001', 'P002']);
  });

  it('no_filled_row_is_a_form_error', () => {
    const result = checkRows([row(1), row(2)]);
    expect(result.formError).toBe('Choose a product and a quantity.');
    expect(result.valid).toBe(false);
    expect(checkRows([]).formError).toBe('Choose a product and a quantity.');
  });

  it('more_rows_than_the_limit_is_a_form_error', () => {
    const many = Array.from({ length: HTTP.maxItems + 1 }, (_, i) => row(i, `P00${i}`, '1'));
    expect(checkRows(many).formError).toBe(`An order can have at most ${HTTP.maxItems} items.`);
    expect(checkRows(many.slice(0, HTTP.maxItems)).valid).toBe(true);
  });

  it('sent_row_ids_follow_the_order_of_the_sent_items', () => {
    const { items, sentRowIds } = checkRows([row(10, 'P003', '1'), row(11), row(12, 'P001', '2')]);
    expect(items.map((i) => i.productId)).toEqual(['P003', 'P001']);
    expect(sentRowIds).toEqual([10, 12]);
  });
});

describe('takenByOthers', () => {
  it('excludes_the_rows_own_choice_and_empty_rows', () => {
    const rows = [row(1, 'P001', '1'), row(2, 'P002'), row(3)];
    expect([...takenByOthers(rows, 1)]).toEqual(['P002']);
    expect([...takenByOthers(rows, 3)].sort()).toEqual(['P001', 'P002']);
  });
});

describe('newRow', () => {
  it('starts_empty', () => {
    expect(newRow(4)).toEqual({ id: 4, productId: '', quantity: '' });
  });
});

describe('buildBody', () => {
  it('build_body_omits_ordered_at_when_undefined', () => {
    expect(JSON.parse(buildBody([{ productId: 'P001', quantity: 2 }], undefined))).toEqual({
      items: [{ productId: 'P001', quantity: 2 }],
    });
  });

  it('build_body_matches_the_server_schema', () => {
    const cases: Row[][] = [
      [row(1, 'P001', '1')],
      [row(1, 'P002', '10000'), row(2, 'P005', ' 3 ')],
      [
        row(1, 'P001', '1'),
        row(2, 'P002', '2'),
        row(3, 'P003', '3'),
        row(4, 'P004', '4'),
        row(5, 'P005', '5'),
      ],
    ];
    for (const rows of cases) {
      const { items, valid } = checkRows(rows);
      expect(valid).toBe(true);
      for (const orderedAt of [undefined, '2026-10-21T10:15:00+07:00']) {
        const parsed = parseOrderRequest(JSON.parse(buildBody(items, orderedAt)));
        expect(parsed.items).toEqual(items);
      }
    }
  });

  it('nothing_check_rows_accepts_is_refused_by_the_server_schema', () => {
    let state = 99;
    const next = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const products = ['', 'P001', 'P002', 'P003', 'P004', 'P005'];
    const quantities = ['', '1', '5', '10000', '0', '10001', '1.5', 'x', ' 7 ', '-1', '1e2'];
    let accepted = 0;
    for (let i = 0; i < 400; i++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 6) }, (_, n) =>
        row(
          n,
          products[Math.floor(next() * products.length)]!,
          quantities[Math.floor(next() * quantities.length)]!,
        ),
      );
      const result = checkRows(rows);
      if (!result.valid) continue;
      accepted++;
      expect(
        () => parseOrderRequest(JSON.parse(buildBody(result.items, undefined))),
        JSON.stringify(rows),
      ).not.toThrow();
    }
    expect(accepted).toBeGreaterThan(30);
  });
});

describe('mapServerErrors', () => {
  it('map_server_errors_uses_the_sent_row_not_the_index', () => {
    const { byRow, general } = mapServerErrors(
      [
        { field: 'items[1].quantity', message: 'quantity must be at least 1' },
        { field: 'items[0].productId', message: 'productId must not be empty' },
      ],
      [10, 12], // rows 10 and 12 were sent; row 11 was empty
    );
    expect(byRow).toEqual({
      12: { quantity: 'quantity must be at least 1' },
      10: { productId: 'productId must not be empty' },
    });
    expect(general).toEqual([]);
  });

  it('unmapped_server_errors_go_to_general', () => {
    const { byRow, general } = mapServerErrors(
      [
        { field: 'orderedAt', message: 'orderedAt must be ISO 8601 with an offset' },
        { field: 'items', message: 'items must have 1 to 5 entries' },
        { field: 'body', message: 'Body must be valid JSON' },
        { field: 'items[7].quantity', message: 'quantity must be a number' }, // no such sent row
      ],
      [1],
    );
    expect(byRow).toEqual({});
    expect(general).toEqual([
      'orderedAt must be ISO 8601 with an offset',
      'items must have 1 to 5 entries',
      'Body must be valid JSON',
      'quantity must be a number',
    ]);
  });
});

describe('digitsOnly', () => {
  it('keeps_digits_and_drops_everything_else', () => {
    expect(digitsOnly('12ab3')).toBe('123');
    expect(digitsOnly('-5')).toBe('5');
    expect(digitsOnly('1e3')).toBe('13');
    expect(digitsOnly('1.5')).toBe('15');
    expect(digitsOnly(' 7 ')).toBe('7');
    expect(digitsOnly('٣')).toBe(''); // a non-ASCII digit is not accepted
  });

  it('cuts_to_the_length_of_the_maximum', () => {
    expect(digitsOnly('123456789')).toBe('12345');
    expect(digitsOnly('')).toBe('');
  });
});

describe('an_empty_item_list', () => {
  it('is_not_valid_and_asks_for_an_item', () => {
    const result = checkRows([]);
    expect(result.valid).toBe(false);
    expect(result.formError).toBe('Choose a product and a quantity.');
    expect(result.items).toEqual([]);
  });
});
