import type { Shortfall } from '@/domain/types';
import type { ApiResult } from './api';
import { mapServerErrors, type Row, type RowErrors } from './form';
import { failureMessage, type Action } from './format';
import type { PlanData, ResultState } from './types';

// What the page does with an answer: what to show, whether the stock may have changed (so it must
// be read again), which rows get a message next to their fields, and whether the order form goes
// back to its empty start (only after a reset the server confirmed).
export type Outcome = {
  result: ResultState;
  refreshStock: boolean;
  rowErrors?: RowErrors;
  clearForm?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPlan = (data: unknown): data is PlanData => isRecord(data) && Array.isArray(data.shipments);

// A place or reset that did not come back as a clear refusal may have written, so the stock is read again.
export function outcomeOf(
  action: Action,
  res: ApiResult<unknown>,
  rows: Row[],
  sentRowIds: number[],
): Outcome {
  const mayHaveWritten = action !== 'preview';
  if (res.kind !== 'envelope') {
    return {
      result: { kind: 'failed', message: failureMessage(action, res) },
      refreshStock: mayHaveWritten,
    };
  }
  const { status, body } = res;
  const failed = (): Outcome => ({
    result: {
      kind: 'failed',
      message: failureMessage(action, { kind: 'envelope', status, info: body.info }),
    },
    refreshStock: mayHaveWritten,
  });

  if (status === 200 || status === 201) {
    if (action === 'reset') {
      return { result: { kind: 'reset' }, refreshStock: true, clearForm: true };
    }
    if (!isPlan(body.data)) return failed();
    return {
      result: { kind: 'plan', placed: action === 'place', plan: body.data },
      refreshStock: action === 'place',
    };
  }

  if (status === 400 && action !== 'reset') {
    const errors =
      isRecord(body.data) && Array.isArray(body.data.errors)
        ? (body.data.errors as { field: string; message: string }[])
        : [];
    const { byRow, general } = mapServerErrors(errors, sentRowIds);
    const lines = [
      ...Object.entries(byRow).flatMap(([id, problem]) => {
        const index = rows.findIndex((r) => r.id === Number(id)) + 1;
        return Object.entries(problem).map(
          ([field, message]) =>
            `Item ${index}, ${field === 'productId' ? 'product' : 'quantity'}: ${message}`,
        );
      }),
      ...general,
    ];
    return {
      result: { kind: 'invalid', info: body.info, lines },
      refreshStock: false,
      rowErrors: byRow,
    };
  }

  if (status === 422 && isRecord(body.data) && typeof body.data.reason === 'string') {
    return {
      result: {
        kind: 'rejected',
        placed: action === 'place',
        info: body.info,
        reason: body.data.reason,
        shortfalls: Array.isArray(body.data.shortfalls)
          ? (body.data.shortfalls as Shortfall[])
          : [],
      },
      refreshStock: action === 'place',
    };
  }

  return failed();
}
