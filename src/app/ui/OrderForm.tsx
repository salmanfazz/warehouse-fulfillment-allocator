import type { FormEvent } from 'react';
import { HTTP } from '@/config';
import { digitsOnly, takenByOthers, type Row, type RowErrors } from './form';
import type { Action } from './format';
import type { Product } from './types';

type Props = {
  products: Product[] | null; // null while the products load
  rows: Row[];
  rowErrors: RowErrors;
  formError: string | null;
  orderedAt: string;
  busy: Action | null;
  onRowChange: (id: number, change: Partial<Row>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: number) => void;
  onOrderedAtChange: (value: string) => void;
  onNow: () => void;
  onPreview: () => void;
  onPlace: () => void;
  onReset: () => void;
};

export function OrderForm(props: Props) {
  const { products, rows, rowErrors, formError, orderedAt, busy } = props;
  const locked = busy !== null || products === null;

  function submit(event: FormEvent) {
    event.preventDefault(); // Enter previews; it never places an order
    props.onPreview();
  }

  return (
    <section className="section" aria-labelledby="order-heading">
      <div className="section-head">
        <h2 id="order-heading">Order</h2>
      </div>
      <form onSubmit={submit} noValidate aria-busy={busy !== null}>
        <fieldset className="items">
          <legend>Items</legend>
          {rows.length === 0 && <p className="hint empty-items">No items. Use Add item.</p>}
          {rows.map((row, index) => {
            const number = index + 1;
            const problem = rowErrors[row.id] ?? {};
            const taken = takenByOthers(rows, row.id);
            return (
              <div className="item-row" key={row.id}>
                <div className="field field-product">
                  <label htmlFor={`product-${row.id}`}>
                    Product<span className="sr-only"> {number}</span>
                  </label>
                  <select
                    id={`product-${row.id}`}
                    value={row.productId}
                    disabled={locked}
                    aria-invalid={problem.productId ? true : undefined}
                    aria-describedby={problem.productId ? `product-${row.id}-error` : undefined}
                    onChange={(e) => props.onRowChange(row.id, { productId: e.target.value })}
                  >
                    <option value="">{products ? 'Select a product' : 'Loading products…'}</option>
                    {products?.map((p) => (
                      <option key={p.id} value={p.id} disabled={taken.has(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {problem.productId && (
                    <p className="field-error" id={`product-${row.id}-error`}>
                      {problem.productId}
                    </p>
                  )}
                </div>
                <div className="field field-quantity">
                  <label htmlFor={`quantity-${row.id}`}>
                    Quantity<span className="sr-only"> {number}</span>
                  </label>
                  <input
                    id={`quantity-${row.id}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={row.quantity}
                    disabled={locked}
                    aria-invalid={problem.quantity ? true : undefined}
                    aria-describedby={problem.quantity ? `quantity-${row.id}-error` : undefined}
                    onChange={(e) =>
                      props.onRowChange(row.id, { quantity: digitsOnly(e.target.value) })
                    }
                  />
                  {problem.quantity && (
                    <p className="field-error" id={`quantity-${row.id}-error`}>
                      {problem.quantity}
                    </p>
                  )}
                </div>
                <div className="field field-action">
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={locked}
                    onClick={() => props.onRemoveRow(row.id)}
                  >
                    Remove<span className="sr-only"> item {number}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {formError && (
            <p className="field-error" role="alert">
              {formError}
            </p>
          )}
        </fieldset>

        <div className="row-tools">
          <button
            type="button"
            id="add-item"
            className="btn"
            disabled={locked || rows.length >= HTTP.maxItems}
            onClick={props.onAddRow}
          >
            Add item
          </button>
          <span className="hint">Up to {HTTP.maxItems} different products.</span>
        </div>

        <div className="when">
          <div className="field">
            <label htmlFor="ordered-at">Ordered at (WIB)</label>
            <input
              id="ordered-at"
              type="datetime-local"
              step={60}
              value={orderedAt}
              disabled={locked}
              aria-describedby="ordered-at-hint"
              onChange={(e) => props.onOrderedAtChange(e.target.value)}
            />
          </div>
          <button type="button" className="btn" disabled={locked} onClick={props.onNow}>
            Now
          </button>
          <p className="hint" id="ordered-at-hint">
            Western Indonesia Time (UTC+7). It decides the delivery-time estimate. Leave empty to
            use the current time.
          </p>
        </div>

        <div className="actions">
          <button type="submit" className="btn" disabled={locked} aria-busy={busy === 'preview'}>
            {busy === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={locked}
            aria-busy={busy === 'place'}
            onClick={props.onPlace}
          >
            {busy === 'place' ? 'Placing…' : 'Place order'}
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy !== null}
            aria-busy={busy === 'reset'}
            onClick={props.onReset}
          >
            {busy === 'reset' ? 'Resetting…' : 'Reset demo data'}
          </button>
        </div>
      </form>
    </section>
  );
}
