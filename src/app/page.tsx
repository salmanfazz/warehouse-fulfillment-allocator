'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { callApi } from './ui/api';
import { buildBody, checkRows, newRow, type Checked, type Row, type RowErrors } from './ui/form';
import type { Action } from './ui/format';
import { OrderForm } from './ui/OrderForm';
import { outcomeOf } from './ui/outcome';
import { ResultPanel } from './ui/ResultPanel';
import { stockChanges } from './ui/stock';
import { StockTable } from './ui/StockTable';
import { currentWibInput, orderedAtFromInput } from './ui/time';
import type { Product, ResultState, WarehouseData } from './ui/types';

const PATHS: Record<Action, string> = {
  preview: '/api/v1/orders/preview',
  place: '/api/v1/orders',
  reset: '/api/v1/reset',
};

const LOAD_ERROR = 'Could not load the products and the stock. Check that the server is running.';

async function fetchProducts(): Promise<Product[] | null> {
  const res = await callApi<{ products: Product[] }>('/api/v1/products');
  return res.kind === 'envelope' && res.status === 200 ? res.body.data.products : null;
}

async function fetchStock(): Promise<WarehouseData[] | null> {
  const res = await callApi<{ warehouses: WarehouseData[] }>('/api/v1/warehouses');
  return res.kind === 'envelope' && res.status === 200 ? res.body.data.warehouses : null;
}

let pageLoadedAtWib: string | undefined;
const noSubscription = () => () => {};
const wibAtPageLoad = () => (pageLoadedAtWib ??= currentWibInput());

function without(errors: RowErrors, id: number): RowErrors {
  const copy = { ...errors };
  delete copy[id];
  return copy;
}

export default function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [stockVersion, setStockVersion] = useState(0);
  const shown = useRef<WarehouseData[] | null>(null); // the stock view on screen, to spot changes

  const [rows, setRows] = useState<Row[]>([newRow(1)]);
  const nextRowId = useRef(2);
  // The default time depends on the clock, which the server cannot know. useSyncExternalStore
  // gives "" while rendering on the server and the real value in the browser, without a mismatch.
  const loadedAtWib = useSyncExternalStore(noSubscription, wibAtPageLoad, () => '');
  const [typedOrderedAt, setTypedOrderedAt] = useState<string | null>(null);
  const orderedAt = typedOrderedAt ?? loadedAtWib;
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [busy, setBusy] = useState<Action | null>(null);
  const running = useRef(false); // stops a second action while one is running, even before React re-renders
  const [result, setResult] = useState<ResultState>(null);

  // Shows a fresh view of the stock and remembers what changed since the previous one.
  const applyStock = useCallback((next: WarehouseData[] | null): boolean => {
    if (next) {
      setChanges(stockChanges(shown.current, next));
      shown.current = next;
      setWarehouses(next);
      setStockVersion((v) => v + 1);
      setStockNotice(null);
      return true;
    }
    if (shown.current) setStockNotice('Could not refresh the stock. Showing the last view.');
    return false;
  }, []);

  const loadStock = useCallback(async () => applyStock(await fetchStock()), [applyStock]);

  // Products and stock arrived (or did not). State is only set from here, after the answers.
  const applyLoaded = useCallback(
    (list: Product[] | null, stock: WarehouseData[] | null) => {
      if (list) setProducts(list);
      applyStock(stock);
      setLoadError(list && shown.current ? null : LOAD_ERROR);
    },
    [applyStock],
  );

  useEffect(() => {
    let ignore = false; // a repeated mount (development) or an unmount must not apply a late answer
    void Promise.all([fetchProducts(), fetchStock()]).then(([list, stock]) => {
      if (!ignore) applyLoaded(list, stock);
    });
    return () => {
      ignore = true;
    };
  }, [applyLoaded]);

  const nameOf = useMemo(() => {
    const names = new Map((products ?? []).map((p) => [p.id, p.name]));
    return (id: string) => names.get(id) ?? id;
  }, [products]);

  function focusFirstProblem(checked: Checked) {
    const firstRow = rows.find((r) => checked.errors[r.id]);
    const target = firstRow
      ? checked.errors[firstRow.id]?.productId
        ? `product-${firstRow.id}`
        : `quantity-${firstRow.id}`
      : `product-${rows[0]?.id}`;
    requestAnimationFrame(() => document.getElementById(target)?.focus());
  }

  async function run(action: Action) {
    if (running.current) return;

    let sentRowIds: number[] = [];
    let body: string | undefined;
    if (action === 'reset') {
      setRowErrors({});
      setFormError(null);
    } else {
      const checked = checkRows(rows);
      setRowErrors(checked.errors);
      setFormError(checked.formError);
      if (!checked.valid) {
        focusFirstProblem(checked);
        return;
      }
      sentRowIds = checked.sentRowIds;
      body = buildBody(checked.items, orderedAtFromInput(orderedAt));
    }

    running.current = true;
    setBusy(action);
    try {
      const res = await callApi<unknown>(PATHS[action], { method: 'POST', body });
      const outcome = outcomeOf(action, res, rows, sentRowIds);
      if (outcome.rowErrors) setRowErrors(outcome.rowErrors);
      setResult(outcome.result);
      if (outcome.refreshStock) await loadStock();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function changeRow(id: number, change: Partial<Row>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...change } : r)));
    setRowErrors((current) => (current[id] ? without(current, id) : current)); // editing a row clears its own messages
    setFormError(null);
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Warehouse Fulfillment Allocator</h1>
        <p>Plan an order across the warehouses, reserve the stock, and see why.</p>
      </header>

      <div className="layout">
        <div className="column">
          <OrderForm
            products={products}
            rows={rows}
            rowErrors={rowErrors}
            formError={formError}
            orderedAt={orderedAt}
            busy={busy}
            onRowChange={changeRow}
            onAddRow={() => {
              const id = nextRowId.current++; // outside the updater: updaters must be pure (Strict Mode runs them twice)
              setRows((current) => [...current, newRow(id)]);
            }}
            onRemoveRow={(id) => {
              setRows((current) => current.filter((r) => r.id !== id));
              setRowErrors((current) => without(current, id));
            }}
            onOrderedAtChange={setTypedOrderedAt}
            onNow={() => setTypedOrderedAt(currentWibInput())}
            onPreview={() => void run('preview')}
            onPlace={() => void run('place')}
            onReset={() => void run('reset')}
          />
          <ResultPanel result={result} nameOf={nameOf} />
        </div>

        <StockTable
          warehouses={warehouses}
          products={products}
          changes={changes}
          version={stockVersion}
          loadError={loadError}
          notice={stockNotice}
          busy={busy !== null}
          onRefresh={() => {
            if (warehouses && products) {
              void loadStock();
            } else {
              setLoadError(null); // Retry: show the loading state again
              void Promise.all([fetchProducts(), fetchStock()]).then(([list, stock]) =>
                applyLoaded(list, stock),
              );
            }
          }}
        />
      </div>

      <p className="page-footer">
        Times are in WIB (UTC+7). Costs are in placeholder cost units; the real rates would replace
        them.
      </p>
    </main>
  );
}
