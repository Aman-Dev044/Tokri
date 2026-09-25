'use client';

/**
 * gross − commission − refunds = net, shown as the equation it is.
 *
 * A payout screen that only prints a final number asks the vendor to take it
 * on faith. Laying the four terms out as an arithmetic strip means anyone —
 * admin, vendor, auditor — can check it by eye in a second, and the explicit
 * check line below says out loud whether the stored `netPayable` agrees with
 * the arithmetic.
 *
 * Everything is integer paise and every value is rendered with <Money/>, which
 * is the only place in the console that divides by 100.
 */

import { Money } from '@/components/admin';

import styles from '../_shared-pages/pages.module.css';

export function Reconciliation({
  grossPaise,
  commissionPaise,
  refundsPaise,
  netPayablePaise,
  commissionPct,
}: {
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  netPayablePaise: number;
  commissionPct?: number;
}) {
  const computed = grossPaise - commissionPaise - refundsPaise;
  const drift = netPayablePaise - computed;
  const reconciles = drift === 0;

  return (
    <div>
      <div className={`${styles.recon} ${styles.scrollX}`}>
        <div className={styles.reconTerm}>
          <span className={styles.reconLabel}>Gross sales</span>
          <span className={styles.reconValue}>
            <Money value={grossPaise} />
          </span>
        </div>

        <span className={styles.reconOp} aria-hidden="true">
          −
        </span>

        <div className={styles.reconTerm}>
          <span className={styles.reconLabel}>
            Commission{commissionPct === undefined ? '' : ` · ${commissionPct}%`}
          </span>
          <span className={styles.reconValue}>
            <Money value={commissionPaise} />
          </span>
        </div>

        <span className={styles.reconOp} aria-hidden="true">
          −
        </span>

        <div className={styles.reconTerm}>
          <span className={styles.reconLabel}>Refunds</span>
          <span className={styles.reconValue}>
            <Money value={refundsPaise} />
          </span>
        </div>

        <span className={styles.reconOp} aria-hidden="true">
          =
        </span>

        <div className={`${styles.reconTerm} ${styles.reconTermResult}`}>
          <span className={styles.reconLabel}>Net payable</span>
          <span className={styles.reconValue}>
            <Money value={netPayablePaise} />
          </span>
        </div>
      </div>

      <p className={`${styles.reconCheck} ${reconciles ? styles.good : styles.crit}`} role="status">
        <span aria-hidden="true">{reconciles ? '✓' : '⚠'}</span>
        {reconciles ? (
          <span>Reconciles exactly — no rounding drift.</span>
        ) : (
          <span>
            Does not reconcile. The arithmetic gives <Money value={computed} />, the stored net
            payable is <Money value={netPayablePaise} />, a difference of <Money value={drift} />.
            Do not pay this out until it is investigated.
          </span>
        )}
      </p>
    </div>
  );
}
