import { useEffect, useRef } from 'react';
import { PLAN } from '@/config';
import {
  breakdownText,
  formatNumber,
  formatRupiah,
  formatWib,
  itemsText,
  reasonInRupiah,
  reasonText,
} from './format';
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
            <p>
              Orders were cleared, the stock is back to its starting amounts, and the order form is
              empty again.
            </p>
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
        <p className="sub">For {formatWib(plan.orderedAt)}</p>
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
                <td className="num">{formatRupiah(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="breakdown">
        <h4>How each cost is worked out</h4>
        <p className="formula">{`Shipment cost = (fixed fee + km × rate per km) × multiplier`}</p>
        <p className="hint">
          {`Fixed fee ${formatRupiah(PLAN.baseCostPerShipment)}, rate ${formatRupiah(PLAN.costPerKm)} per km. The multiplier is ${PLAN.coldMultiplier} for a refrigerated van (the shipment holds a vaccine) and 1 for a standard vehicle. Work out the part in parentheses first.`}
        </p>
        <ul>
          {plan.shipments.map((s) => (
            <li key={s.warehouseId}>
              <strong>{s.warehouseId}</strong> ({formatNumber(s.distanceKm)} km,{' '}
              {s.vehicle === 'refrigerated' ? 'refrigerated' : 'standard'}):{' '}
              {breakdownText(s.distanceKm, s.vehicle)}
            </li>
          ))}
        </ul>
        <p className="hint">
          The cost is per shipment (per trip), so it does not depend on how many units are in it.
        </p>
      </div>

      <ul className="totals">
        <li>
          Total time: <strong>{formatNumber(plan.totalMinutes)} min</strong>, the slowest shipment.
          The shipments travel at the same time, so the order is complete when the last one arrives.
        </li>
        <li>
          Total cost: <strong>{formatRupiah(plan.totalCost)}</strong>, the shipments added together.
        </li>
      </ul>

      <div>
        <h4>Why this plan</h4>
        <ul className="reasons">
          {plan.reasons.map((reason) => (
            <li key={reason}>{reasonInRupiah(reason)}</li>
          ))}
        </ul>
      </div>

      {plan.alternatives.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption>Plans compared</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Warehouses</th>
                <th scope="col" className="num">
                  Shipments
                </th>
                <th scope="col" className="num">
                  Total minutes
                </th>
                <th scope="col" className="num">
                  Total cost
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="chosen">
                <th scope="row">Chosen</th>
                <td>{plan.shipments.map((s) => s.warehouseId).join(' + ')}</td>
                <td className="num">{formatNumber(plan.shipments.length)}</td>
                <td className="num">{formatNumber(plan.totalMinutes)}</td>
                <td className="num">{formatRupiah(plan.totalCost)}</td>
              </tr>
              {plan.alternatives.map((a, index) => (
                <tr key={a.warehouseIds.join('+')}>
                  <th scope="row">{ordinal(index + 2)} best</th>
                  <td>{a.warehouseIds.join(' + ')}</td>
                  <td className="num">{formatNumber(a.warehouseIds.length)}</td>
                  <td className="num">{formatNumber(a.totalMinutes)}</td>
                  <td className="num">{formatRupiah(a.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PlanExplainer />
    </>
  );
}

const ordinal = (n: number): string => ['', '', '2nd', '3rd'][n] ?? `${n}th`;

// The same rules for every order, in plain words. The numbers come from the planner's constants.
function PlanExplainer() {
  return (
    <details className="explainer">
      <summary>How the best plan is chosen</summary>
      <ol>
        <li>
          <strong>Who can ship.</strong> A vaccine needs a warehouse with cold storage and a
          refrigerated van. Other products can ship from any warehouse that has them in stock.
        </li>
        <li>
          <strong>Candidates.</strong> Every group of warehouses that can cover the whole order
          together is a candidate. An order is shipped completely or not at all. Each warehouse in a
          group ships at least one item, and products are taken from the fastest warehouse first.
        </li>
        <li>
          <strong>Speed and cost count equally.</strong>
          {` Each candidate is judged on two things: how long until the last shipment arrives, and the total cost. The task does not say which matters more, so they count equally. To compare minutes with money, ${formatNumber(PLAN.etaScaleMinutes)} minutes is treated as worth the same as ${formatRupiah(PLAN.costScale)}. Both are assumptions of this demo; an operator would choose them. This is why the winner is not always the fastest or the cheapest plan: compare the rows above.`}
        </li>
        <li>
          <strong>Winner.</strong> The plan with the best balance wins. On a tie, fewer shipments
          win, then the warehouse ids. The two runner-ups are in the table above.
        </li>
      </ol>
    </details>
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
