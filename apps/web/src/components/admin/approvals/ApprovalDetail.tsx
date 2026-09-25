'use client';

/**
 * What the operator reads before they decide.
 *
 * The whole point of the drawer is that nobody should have to open three other
 * screens to approve a store. So everything that changes the answer is here —
 * where it is, how far it delivers, what commission it is on, whether it wants
 * COD and up to what value, and what hours it claims to keep.
 *
 * ── WHAT THE API DOES NOT SEND ──────────────────────────────────────────────
 * The approvals payload carries `ownerId`, not the owner's name or phone. Two
 * honest options: show the id, or fetch the user. This shows the id and links
 * to the vendor's own admin page, which already joins the owner — inventing a
 * second round trip per drawer open, for a field the operator can reach in one
 * click, is not worth it.
 *
 * TODO: if Worker A denormalises `ownerName`/`ownerPhone` onto the row, drop
 * them in here — a phone number is the difference between approving and calling
 * to ask one question first.
 */

import Link from 'next/link';

import { Money } from '@/components/admin';
import { formatCount, formatDate, formatPct } from '@/lib/admin/format';

import shared from '../_shared-pages/pages.module.css';
import styles from './approvals.module.css';
import {
  VEHICLE_LABEL,
  summariseHours,
  type RiderApprovalRow,
  type VendorApprovalRow,
} from './fixtures';

/** A value the record does not carry, said out loud rather than left blank. */
function Missing({ what }: { what: string }) {
  return <span className={shared.nullish}>{what}</span>;
}

export function VendorApprovalDetail({ row }: { row: VendorApprovalRow }) {
  return (
    <div className={shared.stack}>
      {row.description === null ? null : (
        <p className={shared.subtle}>{row.description}</p>
      )}

      <dl className={shared.defList}>
        <dt className={shared.dt}>Store</dt>
        <dd className={shared.dd}>
          <span className={shared.strong}>{row.storeName}</span>
          <br />
          <span className={`${shared.subtle} ${shared.mono}`}>{row.slug}</span>
        </dd>

        <dt className={shared.dt}>Owner</dt>
        <dd className={shared.dd}>
          {/* The payload has no owner name. The vendor page joins it. */}
          <span className={shared.mono}>{row.ownerId}</span>
          <br />
          <Link href={`/admin/vendors/${row.id}`}>Open the full vendor record</Link>
        </dd>

        <dt className={shared.dt}>Address</dt>
        <dd className={shared.dd}>
          {row.address.line1}
          {row.address.line2 === null ? null : (
            <>
              <br />
              {row.address.line2}
            </>
          )}
          <br />
          {row.address.city}, {row.address.state}{' '}
          <span className={shared.mono}>{row.address.pincode}</span>
        </dd>

        <dt className={shared.dt}>Coordinates</dt>
        <dd className={shared.dd}>
          {row.location === null ? (
            // No pin means no delivery radius can be computed. That is a reason
            // to hold the application, so it must not read as a blank cell.
            <span className={shared.crit}>no pin dropped — radius cannot be checked</span>
          ) : (
            // Pinned to 4dp — roughly 11m, as precise as a store pin ever needs
            // to be, and it stops the value jittering in width.
            <span className={styles.coords}>
              {row.location.lat.toFixed(4)}, {row.location.lng.toFixed(4)}
            </span>
          )}
        </dd>

        <dt className={shared.dt}>Service radius</dt>
        <dd className={`${shared.dd} ${shared.num}`}>{row.serviceRadiusKm} km</dd>

        <dt className={shared.dt}>Opening hours</dt>
        <dd className={`${shared.dd} ${shared.mono}`}>{summariseHours(row.openingHours)}</dd>
      </dl>

      <div className={shared.panel}>
        <div className={shared.panelHead}>
          <h3 className={shared.panelTitle}>Commercial terms</h3>
        </div>
        <div className={shared.panelBody}>
          <dl className={shared.defList}>
            <dt className={shared.dt}>Commission</dt>
            <dd className={`${shared.dd} ${shared.num}`}>
              {formatPct(row.commissionPct)}
              <span className={shared.subtle}> of order value</span>
            </dd>

            <dt className={shared.dt}>Cash on delivery</dt>
            <dd className={shared.dd}>
              {row.codEnabled ? (
                <>
                  Enabled, capped at <Money value={row.codMaxAmount} /> per order
                </>
              ) : (
                <span className={shared.muted}>Prepaid only</span>
              )}
            </dd>

            <dt className={shared.dt}>Trading history</dt>
            <dd className={shared.dd}>
              {row.orderCount === 0 ? (
                <span className={shared.muted}>none — this store has never traded</span>
              ) : (
                <>
                  <span className={shared.num}>{formatCount(row.orderCount)}</span> orders,{' '}
                  <Money value={row.gmv} /> lifetime
                </>
              )}
            </dd>

            {row.statusReason === null ? null : (
              <>
                <dt className={shared.dt}>Last decision</dt>
                <dd className={shared.dd}>{row.statusReason}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <p className={shared.subtle}>
        {row.createdAt === null ? (
          <Missing what="application date unknown" />
        ) : (
          `Applied ${formatDate(row.createdAt, 'long')}.`
        )}
      </p>
    </div>
  );
}

export function RiderApprovalDetail({ row }: { row: RiderApprovalRow }) {
  return (
    <div className={shared.stack}>
      <dl className={shared.defList}>
        <dt className={shared.dt}>Name</dt>
        <dd className={shared.dd}>
          {row.name === null ? (
            <Missing what="no name on the account" />
          ) : (
            <span className={shared.strong}>{row.name}</span>
          )}
        </dd>

        <dt className={shared.dt}>Phone</dt>
        <dd className={`${shared.dd} ${shared.mono}`}>
          {row.phone ?? <Missing what="not provided" />}
        </dd>

        <dt className={shared.dt}>Email</dt>
        <dd className={shared.dd}>
          {row.email ?? <Missing what="phone is the only contact" />}
        </dd>

        <dt className={shared.dt}>Vehicle</dt>
        <dd className={shared.dd}>{VEHICLE_LABEL[row.vehicleType]}</dd>

        <dt className={shared.dt}>Attached to</dt>
        <dd className={shared.dd}>
          {row.vendorId === null ? (
            <span className={shared.muted}>platform pool — no vendor</span>
          ) : (
            <Link href={`/admin/vendors/${row.vendorId}`}>
              {row.vendorName ?? row.vendorId}
            </Link>
          )}
        </dd>

        <dt className={shared.dt}>User account</dt>
        <dd className={`${shared.dd} ${shared.mono}`}>{row.userId}</dd>

        <dt className={shared.dt}>Applied</dt>
        <dd className={shared.dd}>
          {row.createdAt === null ? (
            <Missing what="application date unknown" />
          ) : (
            formatDate(row.createdAt, 'long')
          )}
        </dd>
      </dl>

      <p className={shared.subtle}>
        A pending partner cannot go online or be assigned a delivery. Approving is what puts them
        in the dispatch pool.
      </p>
    </div>
  );
}
