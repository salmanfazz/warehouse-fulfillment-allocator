import { describe, expect, it } from 'vitest';
import { planOrder } from '@/domain/plan';
import { fieldName, parseOrderRequest, readOrderRequest } from '@/http/schemas';
import { ValidationError } from '@/http/errors';
import { baselineSnapshot } from '../domain/helpers';
import { INVALID_ORDERED_AT, VALID_ORDERED_AT } from '../support/ordered-at-cases';

const ORDERED_AT_MESSAGE =
  'orderedAt must be ISO 8601 with an offset, for example 2026-10-19T08:00:00+07:00';
const ITEMS_MESSAGE = 'items must have 1 to 5 entries';
const item = (productId = 'P001', quantity: unknown = 1) => ({ productId, quantity });
const valid = { items: [item()] };

function errorsOf(body: unknown) {
  try {
    parseOrderRequest(body);
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return ((err as ValidationError).data as { errors: { field: string; message: string }[] })
      .errors;
  }
  throw new Error('expected a ValidationError');
}

describe('parseOrderRequest', () => {
  it('accepts_a_minimal_order', () => {
    expect(parseOrderRequest(valid, () => new Date('2026-10-21T10:00:00Z')).items).toEqual([
      item(),
    ]);
  });

  it('defaults_ordered_at_to_now', () => {
    const input = parseOrderRequest(valid, () => new Date('2026-10-21T10:00:00.123Z'));
    expect(input.orderedAt).toBe('2026-10-21T10:00:00.123Z');
  });

  it('keeps_a_given_ordered_at_untouched', () => {
    const body = { ...valid, orderedAt: '2026-10-19T08:00:00+07:00' };
    expect(parseOrderRequest(body).orderedAt).toBe('2026-10-19T08:00:00+07:00');
  });

  it('items_missing_or_not_a_list', () => {
    expect(errorsOf({})).toEqual([{ field: 'items', message: 'items must be a list' }]);
    expect(errorsOf({ items: 'x' })).toEqual([{ field: 'items', message: 'items must be a list' }]);
    expect(errorsOf({ items: { productId: 'P001', quantity: 1 } })).toEqual([
      { field: 'items', message: 'items must be a list' },
    ]);
  });

  it('items_empty_or_six_entries', () => {
    expect(errorsOf({ items: [] })).toEqual([{ field: 'items', message: ITEMS_MESSAGE }]);
    const six = Array.from({ length: 6 }, (_, i) => item(`P00${i}`));
    expect(errorsOf({ items: six })).toEqual([{ field: 'items', message: ITEMS_MESSAGE }]);
  });

  it('five_entries_are_fine', () => {
    const five = Array.from({ length: 5 }, (_, i) => item(`P00${i}`));
    expect(parseOrderRequest({ items: five }).items).toHaveLength(5);
  });

  it('repeated_product_id', () => {
    const body = { items: [item('P001', 1), item('P002', 1), item('P001', 5)] };
    expect(errorsOf(body)).toEqual([
      { field: 'items[2].productId', message: 'productId P001 is repeated' },
    ]);
  });

  it('quantity_rules', () => {
    const q = (quantity: unknown) => errorsOf({ items: [item('P001', quantity)] })[0]!;
    expect(q(0)).toEqual({ field: 'items[0].quantity', message: 'quantity must be at least 1' });
    expect(q(-1).message).toBe('quantity must be at least 1');
    expect(q(1.5)).toEqual({
      field: 'items[0].quantity',
      message: 'quantity must be a whole number',
    });
    expect(q(10001)).toEqual({
      field: 'items[0].quantity',
      message: 'quantity must be at most 10000',
    });
    for (const bad of ['10', null, true, [], {}, Number.POSITIVE_INFINITY]) {
      expect(q(bad), String(bad)).toEqual({
        field: 'items[0].quantity',
        message: expect.stringMatching(/^quantity must be (a number|a whole number)$/),
      });
    }
  });

  it('a_missing_quantity_is_rejected', () => {
    expect(errorsOf({ items: [{ productId: 'P001' }] })).toEqual([
      { field: 'items[0].quantity', message: 'quantity must be a number' },
    ]);
  });

  it('quantity_bounds_1_and_10000_are_fine', () => {
    expect(parseOrderRequest({ items: [item('P001', 1)] }).items[0]!.quantity).toBe(1);
    expect(parseOrderRequest({ items: [item('P001', 10000)] }).items[0]!.quantity).toBe(10000);
  });

  it('product_id_rules', () => {
    const p = (productId: unknown) => errorsOf({ items: [{ productId, quantity: 1 }] })[0]!;
    expect(p('')).toEqual({ field: 'items[0].productId', message: 'productId must not be empty' });
    expect(p('X'.repeat(33)).message).toBe('productId must be at most 32 characters');
    expect(p(7).message).toBe('productId must be text');
    expect(p(undefined).message).toBe('productId must be text');
    expect(parseOrderRequest({ items: [item('X'.repeat(32))] }).items).toHaveLength(1);
  });

  it('product_id_may_only_contain_plain_characters', () => {
    const message = 'productId may only contain letters, digits, - and _';
    for (const bad of [
      'P\u0000',
      'P 1',
      'P/1',
      'P;1',
      "P'1",
      'P"1',
      'P\\1',
      'ü',
      'P😀',
      'P\n1',
      '%00',
      '<b>',
      'P.1',
    ]) {
      expect(errorsOf({ items: [item(bad)] }), JSON.stringify(bad)).toEqual([
        { field: 'items[0].productId', message },
      ]);
    }
    for (const good of ['P001', 'p_1-2', 'A', '9', 'x'.repeat(32)]) {
      expect(parseOrderRequest({ items: [item(good)] }).items[0]!.productId, good).toBe(good);
    }
  });

  it('an_empty_product_id_gets_one_message_not_two', () => {
    expect(errorsOf({ items: [item('')] })).toEqual([
      { field: 'items[0].productId', message: 'productId must not be empty' },
    ]);
  });

  it('an_invalid_id_that_is_repeated_is_not_also_reported_as_repeated', () => {
    const long = 'Z'.repeat(200);
    const errors = errorsOf({ items: [item(long), item(long)] });
    expect(errors.some((e) => e.message.includes('is repeated'))).toBe(false);
    expect(errors.every((e) => e.message.length < 100)).toBe(true);
  });

  it('unknown_fields_are_capped_and_their_names_truncated', () => {
    const many: Record<string, unknown> = { items: [item()] };
    for (let i = 0; i < 50000; i++) many[`unknown${i}`] = 1;
    const errors = errorsOf(many);
    expect(errors).toHaveLength(6); // five listed plus one summary
    expect(errors[5]).toEqual({ field: 'body', message: 'and 49995 more unknown fields' });
    const huge = errorsOf({ items: [item()], ['k'.repeat(1_000_000)]: 1 });
    expect(JSON.stringify(huge).length).toBeLessThan(300);
  });

  it('unknown_fields_at_both_levels_are_listed_by_name', () => {
    const body = { items: [{ productId: 'P001', quantity: 1, extra: true }], orderAt: 'x' };
    expect(errorsOf(body)).toEqual([
      { field: 'items[0].extra', message: 'extra is not a known field' },
      { field: 'orderAt', message: 'orderAt is not a known field' },
    ]);
  });

  it('every_problem_is_listed_not_just_the_first', () => {
    const body = { items: [item('', 0), item('P002', 1.5)], orderedAt: 'soon', extra: 1 };
    const errors = errorsOf(body);
    expect(errors.map((e) => e.field).sort()).toEqual(
      ['extra', 'items[0].productId', 'items[0].quantity', 'items[1].quantity', 'orderedAt'].sort(),
    );
  });

  it('invalid_ordered_at_values_are_all_rejected', () => {
    for (const orderedAt of INVALID_ORDERED_AT) {
      expect(errorsOf({ ...valid, orderedAt }), JSON.stringify(orderedAt)).toEqual([
        { field: 'orderedAt', message: ORDERED_AT_MESSAGE },
      ]);
    }
  });

  it('valid_ordered_at_values_are_all_accepted', () => {
    for (const orderedAt of VALID_ORDERED_AT) {
      expect(parseOrderRequest({ ...valid, orderedAt }).orderedAt, orderedAt).toBe(orderedAt);
    }
  });

  it('ordered_at_must_be_text', () => {
    for (const orderedAt of [123, null, true, {}, []]) {
      expect(errorsOf({ ...valid, orderedAt })[0]!.field).toBe('orderedAt');
    }
  });

  it('non_object_bodies_are_rejected_as_a_whole', () => {
    for (const body of [null, [], 'text', 12, true]) {
      expect(errorsOf(body)).toEqual([{ field: 'body', message: 'Body must be a JSON object' }]);
    }
  });

  it('nothing_the_schema_accepts_makes_the_domain_throw', () => {
    // seeded so a failure can be reproduced from its number
    let state = 12345;
    const next = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]!;
    // mostly valid choices with a share of bad ones, so both outcomes happen often
    const mostly = <T>(good: T[], bad: T[]) => (next() < 0.8 ? pick(good) : pick(bad));
    const times = (): string | undefined =>
      next() < 0.3 ? undefined : mostly(VALID_ORDERED_AT, INVALID_ORDERED_AT);
    const snapshot = baselineSnapshot();
    let accepted = 0;
    for (let i = 0; i < 300; i++) {
      const count = next() < 0.9 ? 1 + Math.floor(next() * 5) : Math.floor(next() * 8);
      const items = Array.from({ length: count }, () => ({
        productId: mostly(['P001', 'P002', 'P003', 'P004', 'P005', 'P999'], ['', 'x'.repeat(40)]),
        quantity: mostly([1, 5, 100, 10000, 250], [0, -3, 1.5, 10001, '5', null]),
      }));
      const orderedAt = times();
      let input;
      try {
        input = parseOrderRequest(orderedAt === undefined ? { items } : { items, orderedAt });
      } catch (err) {
        expect(err, `case ${i}`).toBeInstanceOf(ValidationError);
        continue;
      }
      accepted++;
      expect(() => planOrder(input, snapshot), `case ${i}`).not.toThrow();
    }
    expect(accepted).toBeGreaterThan(30); // the generator must produce accepted cases too
    expect(accepted).toBeLessThan(270); // ...and rejected ones
  });
});

describe('fieldName', () => {
  it('uses_brackets_for_indexes_and_dots_for_names', () => {
    expect(fieldName(['items', 0, 'quantity'])).toBe('items[0].quantity');
    expect(fieldName(['orderedAt'])).toBe('orderedAt');
    expect(fieldName(['items', 2])).toBe('items[2]');
    expect(fieldName([])).toBe('body');
  });
});

describe('readOrderRequest', () => {
  const request = (body: string, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/v1/orders', { method: 'POST', body, headers });
  const bodyError = async (body: string) => {
    try {
      await readOrderRequest(request(body));
    } catch (err) {
      return ((err as ValidationError).data as { errors: unknown[] }).errors;
    }
    throw new Error('expected a ValidationError');
  };

  it('empty_or_invalid_json_is_a_400_about_the_body', async () => {
    for (const body of ['', '   ', '{', '{"items": [}', 'not json', "{'items': []}"]) {
      expect(await bodyError(body), JSON.stringify(body)).toEqual([
        { field: 'body', message: 'Body must be valid JSON' },
      ]);
    }
  });

  it('json_that_is_not_an_object_is_a_400_about_the_body', async () => {
    for (const body of ['null', '[]', '"text"', '12', 'true']) {
      expect(await bodyError(body), body).toEqual([
        { field: 'body', message: 'Body must be a JSON object' },
      ]);
    }
  });

  it('content_type_is_ignored', async () => {
    const json = JSON.stringify(valid);
    const variants: Record<string, string>[] = [
      {},
      { 'Content-Type': 'text/plain' },
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    ];
    for (const headers of variants) {
      const input = await readOrderRequest(request(json, headers));
      expect(input.items).toEqual([item()]);
    }
  });

  it('proto_key_is_rejected_and_pollutes_nothing', async () => {
    const errors = await bodyError(
      '{"__proto__": {"polluted": true}, "items": [{"productId":"P001","quantity":1}]}',
    );
    expect(errors).toEqual([{ field: '__proto__', message: '__proto__ is not a known field' }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('deeply_nested_json_is_a_400_not_a_crash', async () => {
    const deep = '['.repeat(200000) + ']'.repeat(200000);
    expect(await bodyError(deep)).toHaveLength(1);
  });

  it('a_leading_byte_order_mark_is_stripped_by_request_text_so_the_body_parses', async () => {
    // observed: Request.text() removes a UTF-8 byte order mark before JSON.parse sees it
    const input = await readOrderRequest(request('\ufeff' + JSON.stringify(valid)));
    expect(input.items).toEqual([item()]);
  });
});
