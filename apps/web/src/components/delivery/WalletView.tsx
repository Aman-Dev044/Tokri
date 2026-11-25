'use client';

/**
 * The wallet — the balance a pick fee comes out of, and the ledger behind it.
 *
 * ── WHY THIS SCREEN EXISTS AT ALL ───────────────────────────────────────────
 * A rider pays to accept each order. That money has to be visible, every
 * movement has to be explainable, and the number that decides whether they can
 * work at all has to be the largest thing on screen.
 *
 * ── THE LOW-BALANCE BANNER IS THE SERVER'S VERDICT ──────────────────────────
 * `lowBalance` is computed by the API against `RIDER_LOW_BALANCE_WARN_PAISE`.
 * This screen renders it; it does not re-derive it. A threshold copied into
 * the client is a threshold that disagrees with the one the platform actually
 * enforces the day somebody changes it. The same value arrives live over
 * `wallet.updated` / `wallet.low_balance`, so the banner appears the instant
 * a charge crosses the line rather than on the next refresh.
 *
 * ── TOP-UP IS HONEST ABOUT NOT WORKING ──────────────────────────────────────
 * Razorpay has no keys on this deployment. `POST /delivery/wallet/topup`
 * answers 503 `PAYMENT_PROVIDER_NOT_CONFIGURED` and writes NOTHING — no
 * pending attempt, no fabricated order. The button is still here and still
 * really calls the API, because the code path is real and will work the day a
 * key exists; what it must never do is pretend. So the refusal is rendered as
 * a plain sentence that says the gateway is not switched on, that nothing was
 * charged, and what to do instead.
 *
 * ── THE LEDGER SHOWS SIGNS ──────────────────────────────────────────────────
 * `amountPaise` is signed: negative for a pick fee, positive for a credit. It
 * is rendered with its sign and its own colour, and every row carries the
 * running balance the server stored at that moment — so a rider can reconcile
 * the list against the number at the top rather than taking it on trust.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import styles from './delivery.module.css';
import { Notice } from './Banners';
import { CardSkeleton } from './Skeletons';
import { useRider } from './RiderProvider';
import { IconBox, IconCheck, IconWallet } from './icons';
import { ApiError } from '@/lib/api-client';
import {
  fetchWalletLedger,
  startTopup,
  type TopupOutcome,
} from '@/lib/delivery/wallet-api';
import { money, timeOfDay } from '@/lib/delivery/format';
import type { WalletLedgerRow, WalletTxnType } from '@/lib/delivery/types';

/** The amounts a rider actually picks, in INTEGER PAISE. */
const TOPUP_CHOICES_PAISE = [10_000, 20_000, 50_000, 100_000] as const;

const TXN_LABEL: Record<WalletTxnType, string> = {
  topup: 'Top-up',
  pick_fee: 'Pick fee',
  earning: 'Delivery earning',
  adjustment: 'Adjustment',
  refund: 'Refund',
};

/** "+₹500" / "−₹38". The sign is the direction and is never dropped. */
function signedMoney(paise: number): string {
  if (paise < 0) return `−${money(Math.abs(paise))}`;
  return `+${money(paise)}`;
}

export function WalletView() {
  const { wallet, loading, refresh, loadError } = useRider();

  const [rows, setRows] = useState<WalletLedgerRow[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const [pending, setPending] = useState(false);
  const [topup, setTopup] = useState<TopupOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    void (async () => {
      try {
        const ledger = await fetchWalletLedger(controller.signal);
        if (live) {
          setRows(ledger);
          setLedgerError(null);
        }
      } catch (cause) {
        if (!live) return;
        // An empty ledger is NOT an error, and a failed read must not be
        // rendered as one either — the balance above is still true.
        setRows([]);
        setLedgerError(
          cause instanceof ApiError && !cause.isNetworkError
            ? `Could not load your transactions (${cause.status}).`
            : 'Could not load your transactions. Check your connection.',
        );
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [wallet?.balancePaise]);

  const onTopup = useCallback(async (amountPaise: number) => {
    setPending(true);
    setTopup(null);
    try {
      setTopup(await startTopup(amountPaise));
    } catch {
      setTopup({
        kind: 'unavailable',
        message:
          'Could not reach the payment service. Nothing was charged.',
      });
    } finally {
      setPending(false);
    }
  }, []);

  if (loading && wallet === null) {
    return (
      <>
        <h1 className={styles.h1}>Wallet</h1>
        <CardSkeleton />
      </>
    );
  }

  if (wallet === null) {
    return (
      <>
        <h1 className={styles.h1}>Wallet</h1>
        <Notice tone="crit" title="Could not load your wallet">
          {loadError ??
            'The wallet did not load. Your balance is unchanged — this screen ' +
              'simply could not read it.'}
          <div>
            <button type="button" className={styles.ghost} onClick={refresh}>
              Try again
            </button>
          </div>
        </Notice>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.h1}>Wallet</h1>

      {wallet.lowBalance ? (
        <Notice tone="warn" title="Your balance is low">
          Below {money(wallet.warnThresholdPaise)} you may not be able to
          accept your next order. Each job costs{' '}
          {money(wallet.pickFeeMinPaise)}–{money(wallet.pickFeeMaxPaise)}.
        </Notice>
      ) : null}

      {/* The one number that decides whether the rider can work — the big
          yellow card, unless the server says it is low. */}
      <section
        className={`${styles.balanceCard} ${wallet.lowBalance ? styles.balanceLow : ''}`}
        aria-label="Balance"
      >
        <span className={styles.stepTag}>Balance</span>
        <div className={styles.payoutValue}>{money(wallet.balancePaise)}</div>
        <p className={styles.lede}>
          Each order you accept costs a pick fee of{' '}
          {money(wallet.pickFeeMinPaise)}–{money(wallet.pickFeeMaxPaise)},
          drawn at random per order and taken the moment you accept.
        </p>
      </section>

      <section className={styles.summaryGrid} aria-label="Lifetime totals">
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>
            {money(wallet.lifetimeToppedUpPaise)}
          </div>
          <div className={styles.summaryLabel}>Topped up</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>
            {money(wallet.lifetimeSpentPaise)}
          </div>
          <div className={styles.summaryLabel}>Spent on fees</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>
            {money(wallet.lifetimeEarnedPaise)}
          </div>
          <div className={styles.summaryLabel}>Earned</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{wallet.totalDelivered}</div>
          <div className={styles.summaryLabel}>Delivered</div>
        </div>
      </section>

      {/* ── Top-up ──────────────────────────────────────────────────── */}
      <section className={styles.panel} aria-label="Add money">
        <div className={styles.feeHead}>
          <IconWallet size={20} />
          <h2 className={styles.h2}>Add money</h2>
        </div>

        <div className={styles.topupRow}>
          {TOPUP_CHOICES_PAISE.map((amountPaise) => (
            <button
              key={amountPaise}
              type="button"
              className={styles.topupChip}
              disabled={pending}
              onClick={() => void onTopup(amountPaise)}
            >
              {money(amountPaise)}
            </button>
          ))}
        </div>

        {pending ? <p className={styles.lede}>Opening the gateway…</p> : null}

        {topup?.kind === 'unavailable' ? (
          <Notice tone="warn" title="Top-up is not available yet">
            {topup.message}
          </Notice>
        ) : null}

        {topup?.kind === 'gateway' ? (
          <Notice tone="neutral" title="Gateway order created">
            Order {topup.providerOrderId} for {money(topup.amountPaise)}.
            Complete the payment in the checkout sheet; your balance updates
            as soon as it is confirmed.
          </Notice>
        ) : null}
      </section>

      {/* ── The ledger ──────────────────────────────────────────────── */}
      <h2 className={styles.h2}>Transactions</h2>

      {ledgerError === null ? null : (
        <Notice tone="warn" title="Transactions did not load">
          {ledgerError}
        </Notice>
      )}

      {rows === null ? (
        <CardSkeleton />
      ) : rows.length === 0 ? (
        <section className={styles.panel}>
          <p className={styles.lede}>
            Nothing here yet. Pick fees, top-ups and refunds all appear on this
            list with the balance after each one.
          </p>
        </section>
      ) : (
        <ul className={`${styles.rows} tkr-reveal`}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  {TXN_LABEL[row.type]}
                  {row.orderId === null ? null : (
                    <>
                      {' '}
                      <IconBox size={14} />
                    </>
                  )}
                </div>
                <div className={styles.rowMeta}>
                  {timeOfDay(row.createdAt)}
                  {row.note === null ? '' : ` · ${row.note}`}
                  {` · balance ${money(row.balanceAfterPaise)}`}
                </div>
              </div>
              <div
                className={`${styles.rowValue} ${
                  row.amountPaise < 0 ? styles.amountDebit : styles.amountCredit
                }`}
              >
                {signedMoney(row.amountPaise)}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.lede}>
        <IconCheck size={16} /> A pick fee is refunded automatically if the
        order is cancelled by the store or by support.{' '}
        <Link href="/delivery/profile" className={styles.inlineLink}>
          Verification
        </Link>
      </p>
    </>
  );
}
