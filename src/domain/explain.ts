import { ETA, PLAN } from '@/config';
import type { Bucket, Candidate, FailureFacts, OrderItem, Product } from './types';

// Everything the reasons are built from. One entry of `reasons` is one sentence; extra detail
// goes after a semicolon.
export type PlanContext = {
  items: OrderItem[];
  products: Product[];
  coldCapableIds: string[]; // warehouses that can ship cold-chain products, decided by the caller
  bucket: Bucket;
  chosen: Candidate;
  alternatives: Candidate[]; // runner-ups, best first
  singleWarehouse: Candidate | null; // best one-warehouse plan, when the chosen plan uses several
  recordsInBucket: Record<string, number>; // delivery records per warehouse in the order's bucket
};

const BUCKET_LABEL: Record<Bucket, string> = {
  peak: 'weekday-peak',
  off_peak: 'weekday-off-peak',
  weekend: 'weekend',
};

// "W04", "W04 and W07", "W04, W07 and W08"
export function listIds(ids: string[]): string {
  if (ids.length <= 1) return ids.join('');
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

const roundedMinutes = (c: Candidate) => Math.round(c.slowestMinutes);
const plus = (ids: string[]) => ids.join(' + ');
const difference = (a: number, b: number) => Number((a - b).toFixed(PLAN.costDecimals));

function whoCanShip(ctx: PlanContext): string {
  const orderedCold = ctx.items.some(
    (item) => ctx.products.find((p) => p.id === item.productId)?.requiresColdChain,
  );
  if (!orderedCold) {
    return 'None of the ordered products needs cold chain, so any warehouse holding them can ship them.';
  }
  return `Vaccines need refrigerated storage and a refrigerated van, so only ${listIds(ctx.coldCapableIds)} can ship them.`;
}

function whatWasChosen(ctx: PlanContext): string {
  const { chosen, bucket } = ctx;
  return (
    `Chosen for a ${BUCKET_LABEL[bucket]} order: ${plus(chosen.warehouseIds)}, ` +
    `about ${roundedMinutes(chosen)} min and cost ${chosen.cost} (speed and cost weigh equally).`
  );
}

function howItCompares(ctx: PlanContext): string {
  const { chosen, singleWarehouse } = ctx;
  const next = ctx.alternatives[0];
  if (!next) return 'No other warehouse combination can cover this order.';

  const minutes = roundedMinutes(next) - roundedMinutes(chosen);
  const cost = difference(next.cost, chosen.cost);
  const timePhrase =
    minutes === 0 ? 'same time' : minutes > 0 ? `${minutes} min slower` : `${-minutes} min faster`;
  const costPhrase =
    cost === 0 ? 'same cost' : cost > 0 ? `costs ${cost} more` : `costs ${-cost} less`;
  const figures = cost === 0 ? '' : ` (${next.cost} vs ${chosen.cost})`;
  // "but" when exactly one of the two is worse for the runner-up, "and" otherwise.
  const connector = minutes > 0 !== cost > 0 ? 'but' : 'and';
  const note =
    singleWarehouse && chosen.warehouseIds.length > 1
      ? `; ${singleWarehouseNote(singleWarehouse, next)} could cover the whole order, but the split scores better on speed and cost together`
      : '';
  return `Next best was ${plus(next.warehouseIds)}: ${timePhrase} ${connector} ${costPhrase}${figures}${note}.`;
}

// When the runner-up is itself the single warehouse, the sentence has just named it.
function singleWarehouseNote(single: Candidate, runnerUp: Candidate): string {
  const same = single.warehouseIds.join('+') === runnerUp.warehouseIds.join('+');
  return same ? 'that one warehouse' : `one warehouse (${single.warehouseIds[0]})`;
}

function limitedHistory(ctx: PlanContext): string | null {
  const thin = ctx.chosen.warehouseIds.filter(
    (id) => (ctx.recordsInBucket[id] ?? 0) < ETA.limitedHistoryBelow,
  );
  if (thin.length === 0) return null;
  return thin.length === 1
    ? `Delivery time for ${thin[0]} rests on limited history.`
    : `Delivery times for ${listIds(thin)} rest on limited history.`;
}

// Three sentences, plus a fourth when a warehouse in the plan has little delivery history.
export function explainPlan(ctx: PlanContext): string[] {
  const reasons = [whoCanShip(ctx), whatWasChosen(ctx), howItCompares(ctx)];
  const thin = limitedHistory(ctx);
  if (thin) reasons.push(thin);
  return reasons;
}

// One sentence about the first shortfall (lowest product id), using the full product name.
export function explainFailure(facts: FailureFacts, products: Product[]): string {
  const [first, ...others] = facts.shortfalls;
  if (!first) throw new Error('A failure needs at least one shortfall');
  const name = products.find((p) => p.id === first.productId)?.name ?? first.productId;
  const sentence =
    first.cause === 'UNKNOWN'
      ? `Unknown product: ${first.productId}`
      : first.cause === 'COLD_CHAIN'
        ? `Only ${first.available} of ${first.network} units of ${name} can be shipped with cold chain`
        : `Not enough stock for ${name}: requested ${first.requested}, available ${first.available}`;
  return others.length > 0 ? `${sentence} (and ${others.length} more)` : sentence;
}
