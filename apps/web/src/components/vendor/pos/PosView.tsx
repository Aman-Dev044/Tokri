'use client';

/**
 * The shop counter: find it, bag it, charge it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TOTAL ON THIS SCREEN IS A PREVIEW.                                   │
 * │                                                                          │
 * │ `POST /vendor/pos/sales` receives product ids and quantities — no price, │
 * │ no tax, no total. The API reads every figure from the product, applies   │
 * │ the online checkout's GST, caps the discount, computes the change and     │
 * │ refuses cash that does not cover it. What the customer pays is what the   │
 * │ invoice screen shows after the sale, which is the API's answer.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── SCANNERS ────────────────────────────────────────────────────────────────
 * A USB or Bluetooth scanner is a keyboard that types the code and presses
 * Enter. So the search box IS the scanner input: on Enter it asks the API for
 * an exact barcode match and, if there is one, puts it straight in the cart and
 * clears the box for the next beep. The box keeps focus after every add.
 *
 * ── THE CAMERA ──────────────────────────────────────────────────────────────
 * Only offered where `BarcodeDetector` exists AND the page is a secure context
 * — browsers refuse the camera on plain http, which is how this deployment is
 * currently served. There it is simply not drawn.
 *
 * ── DOUBLE-TAPS ─────────────────────────────────────────────────────────────
 * Each Charge attempt carries an `Idempotency-Key` that is kept until the sale
 * succeeds or the basket changes. A second tap — or a retry after a dropped
 * connection — replays the first sale instead of selling the basket twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDebounced, useVendorMutation, useVendorQuery } from '@/hooks';
import { ApiError, api } from '@/lib/api-client';
import { useVendorSession } from '@/lib/vendor/session';
import {
  PAYMENT_LABEL,
  newSaleKey,
  previewTotals,
  type CartLine,
} from '@/lib/vendor/pos';
import type {
  PosPaymentMode,
  PosProduct,
  PosProductSearch,
  PosSaleCreate,
  PosSaleDetail,
  PosSaleRow,
  PosSalesPage,
} from '@/lib/vendor/types';
import { formatDate } from '../format';
import { IconClose, IconInbox, IconMinus, IconPlus, IconScan, IconSearch, IconTrash } from '../icons';
import { ConfirmDialog } from '../overlay';
import { VenPage, VenSection } from '../Page';
import {
  Btn,
  EmptyState,
  EndpointError,
  Field,
  Money,
  Pill,
  RupeeInput,
  Segmented,
} from '../primitives';
import { SearchBox, Toolbar, VenTable, type Column } from '../table';

type Tab = 'counter' | 'history';

const MODES: readonly PosPaymentMode[] = ['cash', 'upi', 'card'];

/** `errors.lines` on a 409 INSUFFICIENT_STOCK. */
interface ShortLine {
  productId: string;
  name: string;
  requested: number;
  available: number;
}

export function PosView() {
  const session = useVendorSession();
  const [tab, setTab] = useState<Tab>('counter');

  return (
    <VenPage
      title="Billing"
      description="Walk-in sales at your own counter. Your revenue — no platform commission on these."
      actions={
        <Segmented<Tab>
          label="Billing view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'counter', label: 'Counter' },
            { value: 'history', label: 'Sales history' },
          ]}
        />
      }
    >
      {tab === 'counter' ? (
        session.can('billing.create') ? (
          <Counter />
        ) : (
          <EmptyState
            title="You can look, not charge"
            body="Your role can see billing but not ring up sales. The sales history is in the other tab."
            icon={<IconInbox />}
          />
        )
      ) : (
        <SalesHistory />
      )}
    </VenPage>
  );
}

/* ================================================================== */
/* Counter                                                             */
/* ================================================================== */

function Counter() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [term, setTerm] = useState('');
  const debounced = useDebounced(term.trim(), 250);
  const results = useVendorQuery<PosProductSearch>(
    '/vendor/pos/products',
    { q: debounced },
    { enabled: debounced.length > 0 },
  );

  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<PosPaymentMode>('cash');
  const [tendered, setTendered] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [shortLines, setShortLines] = useState<ShortLine[]>([]);
  const [saleKey, setSaleKey] = useState<string>(() => newSaleKey());
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);

  const charge = useVendorMutation<PosSaleCreate, PosSaleDetail>('/vendor/pos/sales', 'POST');
  const resetCharge = charge.reset;

  // Client-only: `window` does not exist during the server render.
  useEffect(() => {
    setCameraAvailable(window.isSecureContext && 'BarcodeDetector' in window);
  }, []);

  /** The basket changed — the next Charge is a NEW sale, with a new key. */
  const touch = useCallback(() => {
    setSaleKey(newSaleKey());
    setShortLines([]);
    resetCharge();
  }, [resetCharge]);

  const add = useCallback(
    (product: PosProduct) => {
      setCart((lines) => {
        const existing = lines.find((line) => line.product.id === product.id);
        if (existing) {
          return lines.map((line) =>
            line.product.id === product.id ? { ...line, product, qty: line.qty + 1 } : line,
          );
        }
        return [...lines, { product, qty: 1 }];
      });
      setNotice(
        product.available <= 0 ? `${product.name} shows no stock — the sale will be refused.` : null,
      );
      touch();
      searchRef.current?.focus();
    },
    [touch],
  );

  /** Enter in the search box, or a camera hit: exact barcode first. */
  const lookup = useCallback(
    async (code: string) => {
      const q = code.trim();
      if (q === '') return;
      try {
        const found = await api.get<PosProductSearch>('/vendor/pos/products', { query: { q } });
        const only = found.items.length === 1 ? found.items[0] : undefined;
        const hit = found.barcodeMatch ?? only ?? null;
        if (hit) {
          add(hit);
          setTerm('');
        } else {
          setNotice(
            found.items.length === 0
              ? `Nothing in this store matches “${q}”.`
              : `${found.items.length} matches — pick one below.`,
          );
        }
      } catch (cause) {
        setNotice(cause instanceof ApiError ? cause.friendlyMessage : 'Lookup failed.');
      }
    },
    [add],
  );

  const setQty = (productId: string, qty: number) => {
    setCart((lines) =>
      qty <= 0
        ? lines.filter((line) => line.product.id !== productId)
        : lines.map((line) => (line.product.id === productId ? { ...line, qty } : line)),
    );
    touch();
  };

  const clear = () => {
    setCart([]);
    setDiscount(0);
    setTendered(0);
    setCustomerPhone('');
    setCustomerName('');
    setNotice(null);
    touch();
    searchRef.current?.focus();
  };

  const totals = useMemo(() => previewTotals(cart, discount), [cart, discount]);
  const change = mode === 'cash' ? tendered - totals.grandTotal : 0;
  const phoneOk = customerPhone === '' || /^\d{10}$/.test(customerPhone);

  const canCharge =
    cart.length > 0 &&
    phoneOk &&
    !charge.loading &&
    (mode !== 'cash' || tendered >= totals.grandTotal);

  const submit = () => {
    setShortLines([]);
    void charge.mutate(
      {
        items: cart.map((line) => ({ productId: line.product.id, qty: line.qty })),
        paymentMode: mode,
        ...(mode === 'cash' ? { cashTenderedPaise: tendered } : {}),
        ...(discount > 0 ? { discountPaise: discount } : {}),
        ...(customerPhone ? { customerPhone } : {}),
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
      },
      {
        idempotencyKey: saleKey,
        invalidate: ['/vendor/pos', '/vendor/inventory', '/vendor/products'],
        onSuccess: (sale) => {
          clear();
          router.push(`/vendor/pos/${sale.id}`);
        },
        onError: (error) => {
          const errors = error.problem.errors as unknown as
            | { code?: string; lines?: ShortLine[] }
            | undefined;
          if (errors?.code === 'INSUFFICIENT_STOCK' && Array.isArray(errors.lines)) {
            setShortLines(errors.lines);
          }
          // A refused sale changed nothing server-side, so the next attempt
          // is a fresh one. (A network failure keeps the key, so a retry
          // replays rather than double-sells.)
          if (!error.isNetworkError) setSaleKey(newSaleKey());
        },
      },
    );
  };

  const items = debounced.length > 0 ? (results.data?.items ?? []) : [];

  return (
    <div className="ven-pos">
      {/* ---------------------------------------------- find ---- */}
      <section className="ven-pos__find" aria-label="Find a product">
        <div className="ven-pos__searchrow">
          <label className="ven-pos__search">
            <IconSearch />
            <span className="ven-sr">Search by name, SKU or scan a barcode</span>
            <input
              ref={searchRef}
              className="ven-input"
              type="search"
              autoFocus
              autoComplete="off"
              placeholder="Scan a barcode, or type a name or SKU…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void lookup(term);
                }
              }}
            />
          </label>
          {cameraAvailable ? (
            <Btn onClick={() => setCameraOpen(true)} title="Scan with the camera">
              <IconScan />
              Camera
            </Btn>
          ) : null}
        </div>

        {notice ? (
          <p className="ven-pos__notice" role="status">
            {notice}
          </p>
        ) : null}

        {results.error && debounced.length > 0 ? (
          <p className="ven-field__error" role="alert">
            {results.error.friendlyMessage}
          </p>
        ) : null}

        <ul className="ven-pos__results" aria-label="Matching products">
          {items.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="ven-pos__result"
                onClick={() => {
                  add(product);
                  setTerm('');
                }}
                data-out={product.available <= 0 ? 'true' : undefined}
              >
                <span className="ven-pos__resultname">
                  <strong>{product.name}</strong>
                  <span className="ven-dim">
                    {product.unitLabel} · {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ''}
                  </span>
                </span>
                <span className="ven-pos__resultprice">
                  <Money value={product.price} />
                  {product.mrp > product.price ? (
                    <s className="ven-dim">
                      <Money value={product.mrp} />
                    </s>
                  ) : null}
                </span>
                <span className="ven-pos__stock" data-low={product.available <= 5 ? 'true' : undefined}>
                  {product.available} left
                </span>
              </button>
            </li>
          ))}
          {debounced.length > 0 && !results.loading && items.length === 0 && !results.error ? (
            <li className="ven-dim ven-pos__none">Nothing matches “{debounced}”.</li>
          ) : null}
        </ul>
      </section>

      {/* ---------------------------------------------- cart ---- */}
      <section className="ven-pos__cart" aria-label="Cart">
        <header className="ven-pos__carthead">
          <h2 className="ven-section__title">Cart</h2>
          <span className="ven-dim">
            {/* Keyed on the count so the figure pops each time it changes. */}
            <span className="ven-pos__pop" key={cart.reduce((sum, line) => sum + line.qty, 0)}>
              {cart.reduce((sum, line) => sum + line.qty, 0)}
            </span>{' '}
            items
          </span>
          {cart.length > 0 ? (
            <Btn size="sm" variant="ghost" onClick={clear}>
              Clear
            </Btn>
          ) : null}
        </header>

        {cart.length === 0 ? (
          <EmptyState
            tight
            title="Empty"
            body="Scan an item or pick one from the search results."
            icon={<IconScan />}
          />
        ) : (
          <ul className="ven-pos__lines">
            {cart.map((line) => {
              const short = shortLines.find((entry) => entry.productId === line.product.id);
              return (
                <li key={line.product.id} className="ven-pos__line" data-short={short ? 'true' : undefined}>
                  <span className="ven-pos__linename">
                    <strong>{line.product.name}</strong>
                    <span className="ven-dim">
                      {line.product.unitLabel} · <Money value={line.product.price} /> each
                    </span>
                    {short ? (
                      <span className="ven-field__error">Only {short.available} in stock</span>
                    ) : null}
                  </span>
                  <span className="ven-pos__stepper">
                    <button
                      type="button"
                      className="ven-adjust__step"
                      aria-label={`One fewer ${line.product.name}`}
                      onClick={() => setQty(line.product.id, line.qty - 1)}
                    >
                      <IconMinus />
                    </button>
                    <input
                      className="ven-input ven-input--num ven-pos__qty"
                      type="number"
                      min={1}
                      max={9999}
                      value={line.qty}
                      aria-label={`Quantity of ${line.product.name}`}
                      onChange={(event) =>
                        setQty(line.product.id, Math.min(9999, Number.parseInt(event.target.value, 10) || 0))
                      }
                    />
                    <button
                      type="button"
                      className="ven-adjust__step"
                      aria-label={`One more ${line.product.name}`}
                      onClick={() => setQty(line.product.id, line.qty + 1)}
                    >
                      <IconPlus />
                    </button>
                  </span>
                  <Money value={line.product.price * line.qty} className="ven-pos__linetotal" />
                  <button
                    type="button"
                    className="ven-iconbtn"
                    onClick={() => setQty(line.product.id, 0)}
                    title={`Remove ${line.product.name}`}
                  >
                    <IconTrash />
                    <span className="ven-sr">Remove {line.product.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* -------------------------------------------- charge ---- */}
      <section className="ven-pos__pay" aria-label="Payment">
        <dl className="ven-pos__totals">
          <dt>Subtotal</dt>
          <dd>
            <Money value={totals.subtotal} />
          </dd>
          <dt>Discount</dt>
          <dd>{totals.discount > 0 ? <Money value={-totals.discount} /> : <Money value={0} />}</dd>
          <dt>GST</dt>
          <dd>
            <Money value={totals.taxes} />
          </dd>
          <dt className="ven-pos__grand">Total</dt>
          <dd className="ven-pos__grand">
            <span className="ven-pos__pop" key={totals.grandTotal}>
              <Money value={totals.grandTotal} />
            </span>
          </dd>
        </dl>
        <p className="ven-field__hint">
          Preview. The server recalculates every figure when you charge.
        </p>

        <Field label="Discount">
          {(id) => (
            <RupeeInput
              id={id}
              value={discount}
              onChange={(paise) => {
                setDiscount(Math.max(0, paise));
                touch();
              }}
            />
          )}
        </Field>

        <div className="ven-field">
          <span className="ven-field__label">Payment</span>
          <div className="ven-pos__modes" role="radiogroup" aria-label="Payment mode">
            {MODES.map((value) => (
              <button
                key={value}
                type="button"
                className="ven-pos__mode"
                role="radio"
                aria-checked={mode === value}
                onClick={() => {
                  setMode(value);
                  touch();
                }}
              >
                {PAYMENT_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {mode === 'cash' ? (
          <Field
            label="Cash received"
            error={
              tendered > 0 && tendered < totals.grandTotal ? 'Less than the total.' : undefined
            }
          >
            {(id) => <RupeeInput id={id} value={tendered} onChange={(paise) => setTendered(Math.max(0, paise))} />}
          </Field>
        ) : null}
        {mode === 'cash' && tendered >= totals.grandTotal && cart.length > 0 ? (
          <p className="ven-pos__change">
            Change{' '}
            <span className="ven-pos__pop" key={change}>
              <Money value={change} dimZero={false} />
            </span>
          </p>
        ) : null}

        <Field
          label="Customer phone (optional)"
          hint="For the WhatsApp invoice."
          error={phoneOk ? undefined : 'Ten digits, no country code.'}
        >
          {(id) => (
            <input
              id={id}
              className="ven-input"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label="Customer name (optional)">
          {(id) => (
            <input
              id={id}
              className="ven-input"
              maxLength={80}
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          )}
        </Field>

        {charge.error ? (
          <p className="ven-field__error" role="alert">
            {charge.error.friendlyMessage}
          </p>
        ) : null}

        <Btn variant="primary" size="lg" className="ven-pos__charge" disabled={!canCharge} onClick={submit}>
          {charge.loading ? 'Charging…' : 'Charge '}
          {charge.loading ? null : (
            <span className="ven-pos__pop" key={totals.grandTotal}>
              <Money value={totals.grandTotal} />
            </span>
          )}
        </Btn>
      </section>

      {cameraOpen ? (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onCode={(code) => {
            setCameraOpen(false);
            void lookup(code);
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Camera scanning — secure contexts with BarcodeDetector only          */
/* ================================================================== */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so a parent re-render does not restart the camera.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let live = true;

    void (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (!Detector) throw new Error('This browser cannot read barcodes.');
        const detector = new Detector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (!live || !video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (!live || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const first = codes[0]?.rawValue;
            if (first) {
              onCodeRef.current(first);
              return;
            }
          } catch {
            /* a frame that cannot be read is not an error — try the next */
          }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'The camera is not available.');
      }
    })();

    return () => {
      live = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="ven-pos__camera" role="dialog" aria-label="Scan with the camera">
      <div className="ven-pos__camerabox">
        <video ref={videoRef} className="ven-pos__video" muted playsInline />
        {error ? <p className="ven-field__error">{error}</p> : <p className="ven-dim">Point the camera at the barcode.</p>}
        <Btn onClick={onClose}>
          <IconClose />
          Close
        </Btn>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Sales history                                                       */
/* ================================================================== */

function SalesHistory() {
  const session = useVendorSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 300);
  const sales = useVendorQuery<PosSalesPage>('/vendor/pos/sales', {
    page,
    limit: 20,
    ...(debounced ? { q: debounced } : {}),
  });

  const voidSale = useVendorMutation<{ reason: string }, PosSaleDetail>(
    '/vendor/pos/sales/:id/void',
    'POST',
  );
  const [voiding, setVoiding] = useState<PosSaleRow | null>(null);
  const [reason, setReason] = useState('');

  const today = sales.data?.today;

  const columns: Column<PosSaleRow>[] = [
    {
      key: 'invoiceNo',
      header: 'Invoice',
      numeric: true,
      render: (row) => <Link href={`/vendor/pos/${row.id}`}>{row.invoiceNo}</Link>,
    },
    {
      key: 'createdAt',
      header: 'When',
      render: (row) => (row.createdAt ? formatDate(row.createdAt, 'short') : '—'),
    },
    { key: 'itemCount', header: 'Items', align: 'right', numeric: true },
    {
      key: 'grandTotal',
      header: 'Total',
      align: 'right',
      render: (row) => <Money value={row.grandTotal} />,
    },
    { key: 'paymentMode', header: 'Paid by', render: (row) => PAYMENT_LABEL[row.paymentMode] },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) =>
        row.customerName || row.customerPhone ? (
          <span>
            {row.customerName ?? ''}
            {row.customerName && row.customerPhone ? ' · ' : ''}
            {row.customerPhone ?? ''}
          </span>
        ) : (
          <span className="ven-dim">walk-in</span>
        ),
    },
    { key: 'cashierName', header: 'Cashier' },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.status === 'voided' ? <Pill tone="crit">Voided</Pill> : <Pill tone="good">Completed</Pill>,
    },
    ...(session.can('billing.void')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (row: PosSaleRow) =>
              row.status === 'completed' ? (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReason('');
                    voidSale.reset();
                    setVoiding(row);
                  }}
                >
                  Void
                </Btn>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="ven-pos__today" aria-label="Today at the counter">
        <div className="ven-pos__todaycell">
          <span className="ven-label">Today</span>
          <strong>
            <Money value={today?.total ?? 0} />
          </strong>
          <span className="ven-dim">{today?.count ?? 0} sales</span>
        </div>
        {MODES.map((value) => (
          <div className="ven-pos__todaycell" key={value}>
            <span className="ven-label">{PAYMENT_LABEL[value]}</span>
            <strong>
              <Money value={today?.byMode[value].total ?? 0} />
            </strong>
            <span className="ven-dim">{today?.byMode[value].count ?? 0} sales</span>
          </div>
        ))}
      </div>

      {sales.error && sales.data === null ? (
        <EndpointError
          path="/vendor/pos/sales"
          message={sales.error.friendlyMessage}
          status={sales.error.status}
          onRetry={sales.refetch}
        />
      ) : null}

      <VenSection>
        <Toolbar>
          <SearchBox
            label="Search sales"
            value={q}
            onChange={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Invoice number, customer phone or name…"
          />
        </Toolbar>
        <VenTable
          columns={columns}
          rows={sales.data?.data ?? []}
          rowKey={(row) => row.id}
          loading={sales.loading && !sales.hasLoadedOnce}
          page={page}
          pageCount={sales.data?.meta.pages}
          total={sales.data?.meta.total}
          onPageChange={setPage}
          empty={<EmptyState title="No counter sales yet" body="Sales you ring up appear here." icon={<IconInbox />} />}
        />
      </VenSection>

      <ConfirmDialog
        open={voiding !== null}
        title={`Void ${voiding?.invoiceNo ?? 'this sale'}?`}
        confirmLabel="Void sale"
        destructive
        loading={voidSale.loading}
        confirmDisabled={reason.trim().length < 3}
        onCancel={() => setVoiding(null)}
        onConfirm={() => {
          if (!voiding) return;
          void voidSale.mutate(
            { reason: reason.trim() },
            {
              params: { id: voiding.id },
              invalidate: ['/vendor/pos', '/vendor/inventory', '/vendor/products'],
              onSuccess: () => setVoiding(null),
            },
          );
        }}
        body={
          <div className="ven-form">
            <p>The items go back into stock and the invoice is marked voided. This cannot be undone.</p>
            <Field label="Reason" hint="Required — it is kept on the invoice and in the audit log.">
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
    </>
  );
}
