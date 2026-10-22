import { formatNumber, formatRupiah, formatWib, itemsText } from './format';
import type { OrderSummaryData } from './types';

type Props = {
  orders: OrderSummaryData[] | null; // null until the first load finishes
  error: string | null; // the last refresh failed; the last view is still shown
  nameOf: (productId: string) => string;
};

const SHORT_ID_LENGTH = 8;

export function OrderHistory({ orders, error, nameOf }: Props) {
  return (
    <section className="section" aria-labelledby="history-heading">
      <div className="section-head">
        <h2 id="history-heading">Order history</h2>
        <span className="hint">Last 20 orders, newest first.</span>
      </div>

      {error && (
        <p className="notice notice-warning" role="status">
          {error}
        </p>
      )}

      {orders === null && !error && <p className="hint">Loading orders…</p>}
      {orders?.length === 0 && <p className="hint">No orders yet. Place one to see it here.</p>}

      {orders && orders.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Placed orders</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Ordered for</th>
                <th scope="col">Items</th>
                <th scope="col">Warehouses</th>
                <th scope="col" className="num">
                  Minutes
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId}>
                  <th scope="row">
                    <span className="order-id" title={o.orderId}>
                      {o.orderId.slice(0, SHORT_ID_LENGTH)}
                    </span>
                  </th>
                  <td>{formatWib(o.orderedAt)}</td>
                  <td>{itemsText(o.items, nameOf)}</td>
                  <td>{o.warehouseIds.join(' + ')}</td>
                  <td className="num">{formatNumber(o.totalMinutes)}</td>
                  <td className="num">{formatRupiah(o.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
