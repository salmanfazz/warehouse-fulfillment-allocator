import { isDeepStrictEqual } from 'node:util';
import { SMOKE } from '../src/config';
import { BASELINE_STOCK } from '../src/db/seed-data';

// Usage: npm run smoke -- <https://your-app.vercel.app>   (optional: CRON_SECRET in the environment)
// Checks a running deployment end to end. It places test orders and then resets the demo data, so
// it only starts on a clean database (no orders, baseline stock) and never deletes anyone's orders.

export type CheckResult = { name: string; status: 'pass' | 'fail' | 'skip'; detail: string };
export type SmokeOptions = { cronSecret?: string };

type Reply = { status: number; headers: Headers; text: string; body: unknown };
type Record_ = Record<string, unknown>;

const APP_TITLE = 'Warehouse Fulfillment Allocator';
// Two orders of 60 against 108 shippable vials: the one that loses sees 48 shippable and 98 in the
// whole network (158 minus 60), so the stock exists but cannot ship cold (rule R8).
const CONCURRENT_REJECTION = 'COLD_CHAIN_UNAVAILABLE';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

const isRecord = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeBaseUrl(input: string): string {
  const url = new URL(input); // throws on garbage
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The URL must start with http:// or https://');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Give the site address only, without a path or query');
  }
  return `${url.protocol}//${url.host}`;
}

const key = (warehouseId: string, productId: string) => `${warehouseId}/${productId}`;
const baseline = new Map(
  BASELINE_STOCK.map((r) => [key(r.warehouse_id, r.product_id), r.quantity]),
);

// The first cell that differs from the baseline (a pair with no row holds 0), or null.
function firstDifference(stock: Map<string, number>): string | null {
  for (const cell of new Set([...baseline.keys(), ...stock.keys()])) {
    const want = baseline.get(cell) ?? 0;
    const got = stock.get(cell) ?? 0;
    if (got !== want) return `${cell} holds ${got}, baseline is ${want}`;
  }
  return null;
}

export async function runSmoke(
  baseUrl: string,
  doFetch: typeof fetch,
  options: SmokeOptions = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let stopped = false; // a failed check the later ones depend on
  let dirty = false; // an order may have been placed and not yet reset

  async function call(path: string, init: RequestInit = {}): Promise<Reply> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(SMOKE.requestTimeoutMs),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON: the checks that need an envelope say so
    }
    return { status: res.status, headers: res.headers, text, body };
  }

  // The data of an answer that has exactly the four envelope keys and code equal to the status.
  function envelope(reply: Reply): unknown {
    const b = reply.body;
    const valid =
      isRecord(b) &&
      Object.keys(b).sort().join() === 'code,data,guid,info' &&
      b.code === reply.status;
    if (!valid) throw new Error(`not an API envelope (status ${reply.status})`);
    return (b as Record_).data;
  }

  const must = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };

  async function check(name: string, run: () => Promise<string>, fatal = false) {
    if (stopped) {
      results.push({ name, status: 'skip', detail: 'not run: an earlier required check failed' });
      return;
    }
    try {
      results.push({ name, status: 'pass', detail: await run() });
    } catch (err) {
      results.push({
        name,
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
      if (fatal) stopped = true;
    }
  }

  const post = (path: string, payload?: unknown) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  const orderBody = (quantity: number, withTime: boolean) => ({
    items: [{ productId: SMOKE.productId, quantity }],
    ...(withTime ? { orderedAt: SMOKE.orderedAt } : {}),
  });

  async function readStock(): Promise<Map<string, number>> {
    const data = envelope(await call('/api/v1/warehouses'));
    const list = isRecord(data) && Array.isArray(data.warehouses) ? data.warehouses : [];
    const stock = new Map<string, number>();
    for (const w of list) {
      if (!isRecord(w) || !isRecord(w.stock)) continue;
      for (const [productId, quantity] of Object.entries(w.stock)) {
        stock.set(key(String(w.id), productId), Number(quantity));
      }
    }
    must(stock.size > 0, 'no stock in the warehouses answer');
    return stock;
  }

  async function orderCount(): Promise<number> {
    const data = envelope(await call('/api/v1/orders'));
    return isRecord(data) && Array.isArray(data.orders) ? data.orders.length : -1;
  }

  async function expectClean(): Promise<void> {
    const orders = await orderCount();
    must(orders === 0, `${orders} order(s) already exist`);
    const difference = firstDifference(await readStock());
    must(difference === null, `stock is not at baseline: ${difference}`);
  }

  function split(data: unknown): { warehouseId: string; quantity: number }[] {
    const shipments = isRecord(data) && Array.isArray(data.shipments) ? data.shipments : [];
    return shipments.map((s) => {
      const items = isRecord(s) && Array.isArray(s.items) ? s.items : [];
      const item = items.find((i) => isRecord(i) && i.productId === SMOKE.productId);
      return {
        warehouseId: isRecord(s) ? String(s.warehouseId) : '?',
        quantity: isRecord(item) ? Number(item.quantity) : 0,
      };
    });
  }

  async function resetAndVerify(): Promise<string> {
    const reply = await post('/api/v1/reset');
    must(reply.status === 200, `reset answered ${reply.status}`);
    await expectClean();
    dirty = false;
    return 'orders cleared, stock back at baseline';
  }

  const splitText = SMOKE.expectedShipments
    .map((s) => `${s.warehouseId} x${s.quantity}`)
    .join(' and ');
  const hepBTotal = BASELINE_STOCK.filter((r) => r.product_id === SMOKE.productId).reduce(
    (sum, r) => sum + r.quantity,
    0,
  );

  try {
    await check(
      'health answers 200 ok',
      async () => {
        const reply = await call('/api/health');
        const data = envelope(reply);
        must(
          reply.status === 200 && isRecord(data) && data.status === 'ok',
          `status ${reply.status}`,
        );
        return 'database reachable';
      },
      true,
    );

    await check('page loads with its title', async () => {
      const reply = await call('/');
      must(reply.status === 200, `status ${reply.status}`);
      must(reply.text.includes(APP_TITLE), 'the title is missing from the page');
      return 'status 200';
    });

    await check('keep-alive without the secret is 401', async () => {
      const reply = await call('/api/cron/keep-alive');
      must(reply.status === 401, `status ${reply.status}`);
      must(envelope(reply) === null, 'the 401 body should have data null');
      return 'status 401';
    });

    // The secret goes out only over https, or to this machine: never in clear text across a network.
    const url = new URL(baseUrl);
    const safeToSend = url.protocol === 'https:' || LOCAL_HOSTS.includes(url.hostname);
    if (options.cronSecret && safeToSend) {
      await check('keep-alive with the secret is 200', async () => {
        const reply = await call('/api/cron/keep-alive', {
          headers: { authorization: `Bearer ${options.cronSecret}` },
        });
        must(reply.status === 200, `status ${reply.status}`);
        return 'status 200';
      });
    } else {
      results.push({
        name: 'keep-alive with the secret is 200',
        status: 'skip',
        detail: options.cronSecret
          ? 'not sent: the URL is plain http and not this machine'
          : 'CRON_SECRET is not set in this shell',
      });
    }

    await check(
      'database is clean before the test',
      async () => {
        await expectClean();
        return 'no orders, stock at baseline';
      },
      true,
    );

    await check(
      'preview of 45 Hep B splits W04 x40 and W07 x5',
      async () => {
        const reply = await post('/api/v1/orders/preview', orderBody(SMOKE.quantity, true));
        const data = envelope(reply);
        must(reply.status === 200, `status ${reply.status}`);
        must(isRecord(data) && data.orderId === undefined, 'a preview must not have an orderId');
        must(
          isDeepStrictEqual(split(data), SMOKE.expectedShipments),
          `unexpected split ${JSON.stringify(split(data))}`,
        );
        return 'status 200, no orderId';
      },
      true,
    );

    await check(
      'preview changed nothing',
      async () => {
        await expectClean();
        return 'no orders, stock at baseline';
      },
      true,
    );

    let placed: unknown;
    await check(
      'place order is 201 with Location and orderId',
      async () => {
        dirty = true;
        const reply = await post('/api/v1/orders', orderBody(SMOKE.quantity, true));
        placed = envelope(reply);
        must(reply.status === 201, `status ${reply.status}`);
        const orderId = isRecord(placed) ? placed.orderId : undefined;
        must(typeof orderId === 'string' && orderId.length > 0, 'no orderId in the answer');
        must(
          reply.headers.get('location') === `/api/v1/orders/${orderId}`,
          'the Location header does not point at the new order',
        );
        return `status 201, order ${String(orderId).slice(0, 8)}`;
      },
      true,
    );

    await check('the order reads back identical', async () => {
      const orderId = isRecord(placed) ? String(placed.orderId) : '';
      const reply = await call(`/api/v1/orders/${orderId}`);
      must(reply.status === 200, `status ${reply.status}`);
      must(isDeepStrictEqual(envelope(reply), placed), 'the stored order differs from the answer');
      return 'status 200, same content';
    });

    await check(
      'stock fell by the shipped vials',
      async () => {
        const stock = await readStock();
        for (const { warehouseId, quantity } of SMOKE.expectedShipments) {
          const want = (baseline.get(key(warehouseId, SMOKE.productId)) ?? 0) - quantity;
          const got = stock.get(key(warehouseId, SMOKE.productId));
          must(got === want, `${warehouseId} holds ${got}, expected ${want}`);
        }
        return `${splitText}: stock reduced by those amounts`;
      },
      true,
    );

    await check('an order for too many vials is 422 and changes nothing', async () => {
      const before = await readStock();
      const reply = await post('/api/v1/orders', orderBody(SMOKE.tooManyQuantity, false));
      const data = envelope(reply);
      must(reply.status === 422, `status ${reply.status}`);
      must(isRecord(data) && data.reason === 'INSUFFICIENT_STOCK', 'wrong reason');
      must(isDeepStrictEqual([...(await readStock())], [...before]), 'stock changed');
      return 'status 422 INSUFFICIENT_STOCK';
    });

    await check('reset restores the baseline', resetAndVerify, true);

    await check(
      'concurrent pair: two simultaneous orders give one 201 and one 422',
      async () => {
        dirty = true;
        const request = () => post('/api/v1/orders', orderBody(SMOKE.concurrentQuantity, false));
        // Wait for both requests even if one fails, so the cleanup reset cannot run before a late order.
        const settled = await Promise.allSettled([request(), request()]);
        const replies = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        must(replies.length === 2, 'one of the two requests got no answer');
        const statuses = replies.map((r) => r.status).sort();
        must(isDeepStrictEqual(statuses, [201, 422]), `statuses ${statuses.join(' and ')}`);
        const rejected = replies.find((r) => r.status === 422);
        const data = rejected ? envelope(rejected) : null;
        must(
          isRecord(data) && data.reason === CONCURRENT_REJECTION,
          `the rejected order carries reason ${isRecord(data) ? String(data.reason) : '?'}, expected ${CONCURRENT_REJECTION}`,
        );
        const stock = await readStock();
        let total = 0;
        for (const [cell, quantity] of stock) {
          must(quantity >= 0, `${cell} is negative`);
          if (cell.endsWith(`/${SMOKE.productId}`)) total += quantity;
        }
        must(
          total === hepBTotal - SMOKE.concurrentQuantity,
          `Hep B stock is ${total}, expected ${hepBTotal - SMOKE.concurrentQuantity}`,
        );
        return 'one placed, one rejected, no negative stock';
      },
      true,
    );

    await check('final reset restores the baseline', resetAndVerify, true);
  } finally {
    if (dirty) {
      try {
        const reply = await post('/api/v1/reset');
        results.push({
          name: 'cleanup reset',
          status: reply.status === 200 ? 'pass' : 'fail',
          detail: `reset answered ${reply.status}`,
        });
      } catch (err) {
        results.push({
          name: 'cleanup reset',
          status: 'fail',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return results;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npm run smoke -- <https://your-app.vercel.app>');
    console.error(
      'It places test orders and then resets the demo data, and only starts on a clean database.',
    );
    process.exitCode = 1;
    return;
  }
  const baseUrl = normalizeBaseUrl(arg);
  console.log(`Smoke test against ${baseUrl}`);
  const results = await runSmoke(baseUrl, fetch, {
    cronSecret: process.env.CRON_SECRET || undefined,
  });
  const mark = { pass: '✓', fail: '✗', skip: '-' };
  for (const r of results) console.log(`${mark[r.status]} ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('smoke.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
