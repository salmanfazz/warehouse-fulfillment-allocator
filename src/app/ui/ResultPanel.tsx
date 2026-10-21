import { useEffect, useRef } from 'react';
import { formatNumber, itemsText, reasonText } from './format';
import type { ResultState } from './types';

type Props = { result: ResultState; nameOf: (productId: string) => string };

export function ResultPanel({ result, nameOf }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);

  // After an action, move focus to the new result heading so keyboard and screen reader users land
  // on the outcome instead of staying on the button.
  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);

  return (
    <section className="section" aria-labelledby="result-heading">
      <div className="section-head">
        <h2 id="result-heading">Result</h2>
      </div>
      <div className="result" aria-live="polite">
        {result === null && <Empty />}
        {result?.kind === 'plan' && <Plan result={result} nameOf={nameOf} heading={heading} />}
        {result?.kind === 'rejected' && (
          <Rejected result={result} nameOf={nameOf} heading={heading} />
        )}
        {result?.kind === 'invalid' && (
          <div className="notice notice-error" role="alert">
            <h3 tabIndex={-1} ref={heading}>
              The order was not sent
            </h3>
            <p>{result.info}</p>
            {result.lines.length > 0 && (
              <ul>
                {result.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result?.kind === 'failed' && (
          <div className="notice notice-error" role="alert">
            <h3 tabIndex={-1} ref={heading}>
              That did not work
            </h3>
            <p>{result.message}</p>
          </div>
        )}
        {result?.kind === 'reset' && (
          <div className="notice notice-ok">
            <h3 tabIndex={-1} ref={heading}>
              Demo data reset
            </h3>
            <p>Orders were cleared and the stock is back to its starting amounts.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Empty() {
  return (
    <div className="result-empty">
      <p>
        Nothing yet. Preview an order to see which warehouses would ship it and why, or place it to
        reserve the stock.
      </p>
    </div>
  );
}

type HeadingRef = { heading: React.RefObject<HTMLHeadingElement | null> };

function Plan({
  result,
  nameOf,
  heading,
}: { result: Extract<ResultState, { kind: 'plan' }>; nameOf: Props['nameOf'] } & HeadingRef) {
  const { plan, placed } = result;
  return (
    <>
      <div className={placed ? 'notice notice-ok' : 'notice'}>
        <h3 tabIndex={-1} ref={heading}>
          {placed ? 'Order placed' : 'Preview: nothing was reserved'}
        </h3>
        {placed && plan.orderId && (
          <p>
            Order <span className="order-id">{plan.orderId}</span>
          </p>
        )}
        <p className="sub">For {plan.orderedAt.replace('T', ' ').replace(/:00\+07:00$/, '')} WIB</p>
      </div>

      <div className="table-scroll">
        <table>
          <caption>Shipments</caption>
          <thead>
            <tr>
              <th scope="col">Warehouse</th>
              <th scope="col">Vehicle</th>
              <th scope="col">Items</th>
              <th scope="col" className="num">
                Minutes
              </th>
              <th scope="col" className="num">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.shipments.map((s) => (
              <tr key={s.warehouseId}>
                <th scope="row">
                  {s.warehouseId}
                  <span className="sub">
                    {s.city} · {formatNumber(s.distanceKm)} km
                  </span>
                </th>
                <td>{s.vehicle === 'refrigerated' ? 'Refrigerated' : 'Standard'}</td>
                <td>{itemsText(s.items, nameOf)}</td>
                <td className="num">{formatNumber(s.minutes)}</td>
                <td className="num">{formatNumber(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="totals">
        Total: <strong>{formatNumber(plan.totalMinutes)} min</strong> (the slowest shipment) ·{' '}
        <strong>{formatNumber(plan.totalCost)} cost units</strong>
      </p>

      <div>
        <h4>Why this plan</h4>
        <ul className="reasons">
          {plan.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      {plan.alternatives.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>Other options</caption>
            <thead>
              <tr>
                <th scope="col">Warehouses</th>
                <th scope="col" className="num">
                  Total minutes
                </th>
                <th scope="col" className="num">
                  Total cost
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.alternatives.map((a) => (
                <tr key={a.warehouseIds.join('+')}>
                  <th scope="row">{a.warehouseIds.join(' + ')}</th>
                  <td className="num">{formatNumber(a.totalMinutes)}</td>
                  <td className="num">{formatNumber(a.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Rejected({
  result,
  nameOf,
  heading,
}: { result: Extract<ResultState, { kind: 'rejected' }>; nameOf: Props['nameOf'] } & HeadingRef) {
  return (
    <>
      <div className="notice notice-warning" role="alert">
        <h3 tabIndex={-1} ref={heading}>
          The order cannot be fulfilled
        </h3>
        <p>{result.info}</p>
        <p className="sub">{reasonText(result.reason)}. Nothing was reserved.</p>
      </div>
      {result.shortfalls.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>What is missing</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Requested
                </th>
                <th scope="col" className="num">
                  Can be shipped
                </th>
              </tr>
            </thead>
            <tbody>
              {result.shortfalls.map((s) => (
                <tr key={s.productId}>
                  <th scope="row">{nameOf(s.productId)}</th>
                  <td className="num">{formatNumber(s.requested)}</td>
                  <td className="num">{formatNumber(s.available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
