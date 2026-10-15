'use client';

/**
 * The per-product movement trail — `GET /vendor/inventory/:productId/logs`.
 *
 * Every stock change writes an `InventoryLog` row inside the same transaction
 * that changes the number: a restock, a manual correction, and the three the
 * order lifecycle writes on its own (reserve at checkout, release on a
 * cancellation or a partial-fulfilment drop, commit on delivery). This drawer
 * is the first vendor-facing place that reads that trail back.
 */

import { useState } from 'react';
import { useVendorQuery } from '@/hooks';
import { humanise } from '../format';
import type { InventoryLogRow, Paged } from '@/lib/vendor/types';
import { Drawer } from '../overlay';
import { Btn, EmptyState, EndpointError, RelativeTime, SkelLine } from '../primitives';
import { IconInbox } from '../icons';

const LIMIT = 20;

export interface InventoryHistoryProps {
  /** null closes the drawer. */
  productId: string | null;
  productName: string;
  onClose: () => void;
}

export function InventoryHistory({ productId, productName, onClose }: InventoryHistoryProps) {
  const [page, setPage] = useState(1);

  const logs = useVendorQuery<Paged<InventoryLogRow>>(
    `/vendor/inventory/${encodeURIComponent(productId ?? '')}/logs`,
    { page, limit: LIMIT },
    { enabled: productId !== null },
  );

  const rows = logs.data?.data ?? [];
  const meta = logs.data?.meta;

  return (
    <Drawer
      open={productId !== null}
      onClose={() => {
        setPage(1);
        onClose();
      }}
      title="Stock movement"
      subtitle={productName}
      width="min(560px, 96vw)"
    >
      {logs.error && logs.data === null ? (
        <EndpointError
          path={`/vendor/inventory/${productId ?? ''}/logs`}
          message={logs.error.friendlyMessage}
          status={logs.error.status}
          onRetry={logs.refetch}
        />
      ) : logs.loading && !logs.hasLoadedOnce ? (
        <div className="ven-stack">
          {[0, 1, 2, 3].map((i) => (
            <SkelLine key={i} height={40} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No movement recorded yet"
          body="Every restock, correction and order-driven change to this product will show up here."
          icon={<IconInbox />}
        />
      ) : (
        <div className="ven-timeline">
          {rows.map((row) => (
            <div className="ven-tl" key={row.id}>
              <span className="ven-tl__dot" aria-hidden="true" />
              <div>
                <p className="ven-tl__to">
                  <span className="ven-num" data-negative={row.delta < 0 ? 'true' : undefined}>
                    {row.delta > 0 ? '+' : ''}
                    {row.delta}
                  </span>{' '}
                  · {humanise(row.reason)}
                </p>
                <p className="ven-tl__meta">
                  <RelativeTime value={row.at} live={false} />
                  {row.refId !== null ? ` · order ${row.refId}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {meta !== undefined && meta.pages > 1 ? (
        <div className="ven-row" style={{ marginTop: 'var(--s-4)', justifyContent: 'center' }}>
          <Btn size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Newer
          </Btn>
          <span className="ven-dim">
            Page {meta.page} of {meta.pages}
          </span>
          <Btn
            size="sm"
            onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}
            disabled={page >= meta.pages}
          >
            Older
          </Btn>
        </div>
      ) : null}
    </Drawer>
  );
}
