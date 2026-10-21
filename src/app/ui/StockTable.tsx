import { canShipCold, coldChainLabel, formatChange, formatNumber } from './format';
import type { Product, WarehouseData } from './types';

type Props = {
  warehouses: WarehouseData[] | null; // null until the first load finishes
  products: Product[] | null;
  changes: Record<string, number>;
  version: number; // grows with every refresh, so the highlight replays
  loadError: string | null; // the first load did not bring both products and stock; Retry asks again
  notice: string | null; // a later refresh failed; the last view is still shown
  busy: boolean;
  onRefresh: () => void;
};

export function StockTable({
  warehouses,
  products,
  changes,
  version,
  loadError,
  notice,
  busy,
  onRefresh,
}: Props) {
  return (
    <section className="section stock-section" aria-labelledby="stock-heading">
      <div className="section-head">
        <h2 id="stock-heading">Stock</h2>
        <button type="button" className="btn" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {notice && (
        <p className="notice notice-warning" role="status">
          {notice}
        </p>
      )}

      {loadError && (
        <div className="notice notice-error" role="alert">
          <p>{loadError}</p>
          <p>
            <button type="button" className="btn" disabled={busy} onClick={onRefresh}>
              Retry
            </button>
          </p>
        </div>
      )}

      {!warehouses && !loadError && (
        <div className="skeleton-rows" aria-busy="true" aria-label="Loading stock">
          {Array.from({ length: 8 }, (_, i) => (
            <span className="skeleton" key={i} />
          ))}
        </div>
      )}

      {warehouses && products && (
        <>
          <div className="table-scroll">
            <table className="stock-table">
              <caption className="sr-only">Stock per warehouse and product</caption>
              <thead>
                <tr>
                  <th scope="col">Warehouse</th>
                  <th scope="col">Cold chain</th>
                  {products.map((p) => (
                    <th scope="col" className="num" key={p.id}>
                      {p.id}
                      <span className="sub">{p.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id}>
                    <th scope="row">
                      {w.id}
                      <span className="sub">
                        {w.city} · {formatNumber(w.distanceKm)} km
                      </span>
                    </th>
                    <td>{coldChainLabel(w)}</td>
                    {products.map((p) => {
                      const quantity = w.stock[p.id] ?? 0;
                      const change = changes[`${w.id}/${p.id}`];
                      const dimmed = p.requiresColdChain && !canShipCold(w);
                      return (
                        <td
                          key={`${p.id}-${change === undefined ? 'same' : version}`}
                          className={[
                            'num',
                            dimmed ? 'dim' : '',
                            change === undefined ? '' : 'changed',
                          ]
                            .join(' ')
                            .trim()}
                        >
                          {formatNumber(quantity)}
                          {change !== undefined && ' '}
                          {change !== undefined && (
                            <span className={`delta ${change < 0 ? 'down' : 'up'}`}>
                              ({formatChange(change)})
                              <span className="sr-only"> since the last view</span>
                            </span>
                          )}
                          {dimmed && (
                            <span className="sr-only"> (cannot be shipped cold from here)</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legend">
            Dimmed: cold-chain stock in a warehouse that cannot ship it, so planning ignores it. In
            brackets: what the last action changed.
          </p>
        </>
      )}
    </section>
  );
}
