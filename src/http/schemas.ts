import { z } from 'zod';
import { HTTP } from '@/config';
import { isValidOrderedAt } from '@/domain/time';
import type { OrderInput } from '@/domain/types';
import { ValidationError, type FieldError } from './errors';

const ITEMS_MESSAGE = `items must have 1 to ${HTTP.maxItems} entries`;
const ORDERED_AT_MESSAGE =
  'orderedAt must be ISO 8601 with an offset, for example 2026-10-19T08:00:00+07:00';

// No custom message on the objects themselves: it would also replace the "unknown field" message.
const itemSchema = z.strictObject({
  productId: z
    .string({ error: 'productId must be text' })
    .min(1, 'productId must not be empty')
    .max(
      HTTP.maxProductIdLength,
      `productId must be at most ${HTTP.maxProductIdLength} characters`,
    ),
  quantity: z
    .number({ error: 'quantity must be a number' })
    .int('quantity must be a whole number')
    .min(1, 'quantity must be at least 1')
    .max(HTTP.maxQuantity, `quantity must be at most ${HTTP.maxQuantity}`),
});

const orderSchema = z.strictObject({
  items: z
    .array(itemSchema, { error: 'items must be a list' })
    .min(1, ITEMS_MESSAGE)
    .max(HTTP.maxItems, ITEMS_MESSAGE)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (typeof item?.productId !== 'string') return;
        if (seen.has(item.productId)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'productId'],
            message: `productId ${item.productId} is repeated`,
          });
        }
        seen.add(item.productId);
      });
    }),
  // The domain's own validator, so the request schema and the domain can never disagree about
  // what a valid time is (a time the domain rejects would otherwise become a 500).
  orderedAt: z
    .string({ error: 'orderedAt must be text' })
    .refine(isValidOrderedAt, ORDERED_AT_MESSAGE)
    .optional(),
});

// ['items', 0, 'quantity'] -> items[0].quantity; a problem with the body as a whole -> body
export function fieldName(path: PropertyKey[]): string {
  if (path.length === 0) return 'body';
  return path.reduce<string>(
    (name, part) =>
      typeof part === 'number'
        ? `${name}[${part}]`
        : name
          ? `${name}.${String(part)}`
          : String(part),
    '',
  );
}

function toFieldErrors(issues: z.core.$ZodIssue[]): FieldError[] {
  return issues.flatMap((issue): FieldError[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: fieldName([...issue.path, key]),
        message: `${key} is not a known field`,
      }));
    }
    return [{ field: fieldName(issue.path), message: issue.message }];
  });
}

// Checks a parsed JSON body. A missing orderedAt becomes "now", so the plan has a time to bucket.
export function parseOrderRequest(body: unknown, now: () => Date = () => new Date()): OrderInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: 'body', message: 'Body must be a JSON object' }]);
  }
  const result = orderSchema.safeParse(body);
  if (!result.success) throw new ValidationError(toFieldErrors(result.error.issues));
  return {
    items: result.data.items,
    orderedAt: result.data.orderedAt ?? now().toISOString(),
  };
}

// The body is parsed as JSON whatever the Content-Type says (curl sends a form type by default).
export async function readOrderRequest(req: Request): Promise<OrderInput> {
  const text = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ValidationError([{ field: 'body', message: 'Body must be valid JSON' }]);
  }
  return parseOrderRequest(body);
}
