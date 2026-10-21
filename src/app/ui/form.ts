import { HTTP } from '@/config';
import type { OrderItem } from '@/domain/types';

// One line of the order form. `quantity` is the text as typed.
export type Row = { id: number; productId: string; quantity: string };
export type RowErrors = Record<number, { productId?: string; quantity?: string }>;

export const newRow = (id: number): Row => ({ id, productId: '', quantity: '' });

const QUANTITY_MESSAGE = `Enter a whole number from 1 to ${HTTP.maxQuantity}`;
const WHOLE_NUMBER = /^\d+$/;

export type Checked = {
  items: OrderItem[];
  sentRowIds: number[]; // the row behind each item, in the same order
  errors: RowErrors;
  formError: string | null;
  valid: boolean;
};

// The quick checks before anything is sent. The server checks the same rules again and stays the
// authority; this only saves a round trip and puts the message next to the right field.
export function checkRows(rows: Row[]): Checked {
  const items: OrderItem[] = [];
  const sentRowIds: number[] = [];
  const errors: RowErrors = {};
  const seen = new Set<string>();

  for (const row of rows) {
    const text = row.quantity.trim();
    if (!row.productId && !text) continue; // a completely empty row is simply ignored

    const problem: { productId?: string; quantity?: string } = {};
    if (!row.productId) problem.productId = 'Choose a product';
    else if (seen.has(row.productId)) problem.productId = 'This product is already in the order';
    const quantity = Number(text);
    if (!WHOLE_NUMBER.test(text) || quantity < 1 || quantity > HTTP.maxQuantity) {
      problem.quantity = QUANTITY_MESSAGE;
    }

    if (problem.productId || problem.quantity) {
      errors[row.id] = problem;
    } else {
      seen.add(row.productId);
      items.push({ productId: row.productId, quantity });
      sentRowIds.push(row.id);
    }
    if (row.productId) seen.add(row.productId);
  }

  const filled = rows.filter((r) => r.productId || r.quantity.trim()).length;
  let formError: string | null = null;
  if (filled === 0) formError = 'Choose a product and a quantity.';
  else if (filled > HTTP.maxItems) formError = `An order can have at most ${HTTP.maxItems} items.`;

  return {
    items,
    sentRowIds,
    errors,
    formError,
    valid: Object.keys(errors).length === 0 && !formError,
  };
}

// Products the select of this row must not offer again, because another row already has them.
export function takenByOthers(rows: Row[], rowId: number): Set<string> {
  return new Set(rows.filter((r) => r.id !== rowId && r.productId).map((r) => r.productId));
}

export function buildBody(items: OrderItem[], orderedAt: string | undefined): string {
  return JSON.stringify(orderedAt ? { items, orderedAt } : { items });
}

const ITEM_FIELD = /^items\[(\d+)\]\.(productId|quantity)$/;

// The server numbers items by their position in what was sent, which skips empty rows. This turns
// "items[1].quantity" back into the row the user is looking at. Whatever has no row is returned
// as plain sentences for the form-level message.
export function mapServerErrors(
  errors: { field: string; message: string }[],
  sentRowIds: number[],
): { byRow: RowErrors; general: string[] } {
  const byRow: RowErrors = {};
  const general: string[] = [];
  for (const { field, message } of errors) {
    const match = ITEM_FIELD.exec(field);
    const rowId = match ? sentRowIds[Number(match[1])] : undefined;
    if (match && rowId !== undefined) {
      (byRow[rowId] ??= {})[match[2] as 'productId' | 'quantity'] ??= message;
    } else {
      general.push(message);
    }
  }
  return { byRow, general };
}
