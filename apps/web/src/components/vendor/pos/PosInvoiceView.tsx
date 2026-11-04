'use client';

/**
 * One counter invoice — exactly what `GET /vendor/pos/sales/:id` returned.
 *
 * Every figure here is the API's: the cart screen's numbers were a preview and
 * are gone by the time this renders. Store name and address come from the
 * SALE (snapshotted when it was rung up), so reprinting an old invoice after
 * the shop moves still prints the address the customer bought from.
 *
 * ── PRINT / PDF ─────────────────────────────────────────────────────────────
 * `window.print()` and a print stylesheet in vendor.css that hides the panel
 * chrome and lays the invoice out for paper. "Save as PDF" is the browser's own
 * print destination — no PDF library ships to the client.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { useVendorSession } from '@/lib/vendor/session';
import { PAYMENT_LABEL, whatsappLink } from '@/lib/vendor/pos';
import type { PosSaleDetail } from '@/lib/vendor/types';
import { formatDate } from '../format';
import { IconPrint, IconShare } from '../icons';
import { ConfirmDialog } from '../overlay';
import { VenPage } from '../Page';
import { Btn, EndpointError, Field, Money, Pill, SkelLine } from '../primitives';

export function PosInvoiceView({ saleId }: { saleId: string }) {
  const session = useVendorSession();
  const path = `/vendor/pos/sales/${saleId}`;
  const sale = useVendorQuery<PosSaleDetail>(path);
  const voidSale = useVendorMutation<{ reason: string }, PosSaleDetail>(
    '/vendor/pos/sales/:id/void',
    'POST',
  );
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');

  const data = sale.data;
  const share = data ? whatsappLink(data) : null;

  return (
    <VenPage
      title={data ? data.invoiceNo : 'Invoice'}
      breadcrumbs={[{ label: 'Billing', href: '/vendor/pos' }, { label: data?.invoiceNo ?? 'Invoice' }]}
      actions={
        <div className="ven-row ven-noprint">
          <Link className="ven-btn" data-variant="primary" data-size="md" href="/vendor/pos">
            New sale
          </Link>
          <Btn onClick={() => window.print()} disabled={!data}>
            <IconPrint />
            Print / PDF
          </Btn>
          {share ? (
            <a className="ven-btn" data-variant="plain" data-size="md" href={share} target="_blank" rel="noopener noreferrer">
              <IconShare />
              WhatsApp
            </a>
          ) : null}
          {data && data.status === 'completed' && session.can('billing.void') ? (
            <Btn
              variant="danger"
              onClick={() => {
                setReason('');
                voidSale.reset();
                setVoidOpen(true);
              }}
            >
              Void
            </Btn>
          ) : null}
        </div>
      }
    >
      {sale.error && data === null ? (
        <EndpointError path={path} message={sale.error.friendlyMessage} status={sale.error.status} onRetry={sale.refetch} />
      ) : null}

      {data === null ? (
        sale.loading ? (
          <div className="ven-invoice">
            <SkelLine width="40%" height={20} />
            <SkelLine width="70%" />
            <SkelLine width="60%" />
          </div>
        ) : null
      ) : (
        <article className="ven-invoice" data-voided={data.status === 'voided' ? 'true' : undefined}>
          <header className="ven-invoice__head">
            <div>
              <h2 className="ven-invoice__store">{data.store.name}</h2>
              <p className="ven-invoice__addr">
                {data.store.address.line1}
                {data.store.address.line2 ? `, ${data.store.address.line2}` : ''}
                <br />
                {data.store.address.city}, {data.store.address.state} {data.store.address.pincode}
              </p>
            </div>
            <dl className="ven-invoice__meta">
              <dt>Tax invoice</dt>
              <dd className="ven-mono">{data.invoiceNo}</dd>
              <dt>Date</dt>
              <dd>{data.createdAt ? formatDate(data.createdAt, 'long') : '—'}</dd>
              <dt>Cashier</dt>
              <dd>{data.cashier.name}</dd>
              {data.customer.name || data.customer.phone ? (
                <>
                  <dt>Customer</dt>
                  <dd>
                    {data.customer.name ?? ''}
                    {data.customer.name && data.customer.phone ? ' · ' : ''}
                    {data.customer.phone ?? ''}
                  </dd>
                </>
              ) : null}
            </dl>
          </header>

          {data.void ? (
            <p className="ven-invoice__void" role="status">
              <Pill tone="crit">Voided</Pill> {data.void.reason}
              {data.void.byName ? ` — ${data.void.byName}` : ''}
              {data.void.at ? `, ${formatDate(data.void.at, 'long')}` : ''}
            </p>
          ) : null}

          <table className="ven-invoice__items">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="ven-num">Qty</th>
                <th scope="col" className="ven-num">MRP</th>
                <th scope="col" className="ven-num">Price</th>
                <th scope="col" className="ven-num">GST</th>
                <th scope="col" className="ven-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.productId}>
                  <td>
                    {item.name}
                    <span className="ven-invoice__sub">
                      {item.unitLabel} · {item.sku}
                    </span>
                  </td>
                  <td className="ven-num">{item.qty}</td>
                  <td className="ven-num">
                    <Money value={item.mrp} />
                  </td>
                  <td className="ven-num">
                    <Money value={item.unitPrice} />
                  </td>
                  <td className="ven-num">
                    <Money value={item.gst} dimZero={false} />
                    <span className="ven-invoice__sub">{item.gstRate}%</span>
                  </td>
                  <td className="ven-num">
                    <Money value={item.lineTotal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ven-invoice__totals">
            <dt>Subtotal</dt>
            <dd>
              <Money value={data.subtotal} />
            </dd>
            {data.discount > 0 ? (
              <>
                <dt>Discount</dt>
                <dd>
                  <Money value={-data.discount} />
                </dd>
              </>
            ) : null}
            <dt>Taxable value</dt>
            <dd>
              <Money value={data.taxableValue} />
            </dd>
            <dt>GST</dt>
            <dd>
              <Money value={data.taxes} dimZero={false} />
            </dd>
            <dt className="ven-invoice__grand">Total</dt>
            <dd className="ven-invoice__grand">
              <Money value={data.grandTotal} dimZero={false} />
            </dd>
            <dt>Paid by</dt>
            <dd>{PAYMENT_LABEL[data.paymentMode]}</dd>
            {data.cashTendered !== null ? (
              <>
                <dt>Cash received</dt>
                <dd>
                  <Money value={data.cashTendered} />
                </dd>
                <dt>Change</dt>
                <dd>
                  <Money value={data.change ?? 0} dimZero={false} />
                </dd>
              </>
            ) : null}
          </dl>

          <p className="ven-invoice__foot">Thank you for shopping with us.</p>
        </article>
      )}

      <ConfirmDialog
        open={voidOpen}
        title={`Void ${data?.invoiceNo ?? 'this sale'}?`}
        confirmLabel="Void sale"
        destructive
        loading={voidSale.loading}
        confirmDisabled={reason.trim().length < 3}
        onCancel={() => setVoidOpen(false)}
        onConfirm={() => {
          if (!data) return;
          void voidSale.mutate(
            { reason: reason.trim() },
            {
              params: { id: data.id },
              invalidate: ['/vendor/pos', '/vendor/inventory', '/vendor/products'],
              onSuccess: () => setVoidOpen(false),
            },
          );
        }}
        body={
          <div className="ven-form">
            <p>The items go back into stock and the invoice is marked voided. This cannot be undone.</p>
            <Field label="Reason" hint="Required — kept on the invoice and in the audit log.">
              {(id) => (
                <textarea
                  id={id}
                  className="ven-input"
                  rows={3}
                  maxLength={300}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </Field>
            {voidSale.error ? (
              <p className="ven-field__error" role="alert">
                {voidSale.error.friendlyMessage}
              </p>
            ) : null}
          </div>
        }
      />
    </VenPage>
  );
}
