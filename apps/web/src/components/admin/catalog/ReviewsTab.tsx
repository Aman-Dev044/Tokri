'use client';

import { useMemo, useState } from 'react';

import { ConfirmDialog, DataTable, FilterBar, RelativeTime, StatusPill } from '@/components/admin';
import { useAdminMutation } from '@/hooks';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { cleanParams, pageCount, paginate, useSourcedList } from '../_shared-pages/useSourced';
import { REVIEWS_FIXTURE, type AdminReviewRow } from './reviews-fixtures';

const ENDPOINT = '/admin/reviews';
const LIMIT = 12;
/** Mirrors `SetReviewVisibilityDto`: 3–300 characters. The API re-checks it. */
const REASON_MIN = 3;
const REASON_MAX = 300;

const STATUS_OPTIONS = [
  { label: 'All reviews', value: '' },
  { label: 'Visible', value: 'visible' },
  { label: 'Hidden', value: 'hidden' },
];

const RATING_OPTIONS = [
  { label: 'Any rating', value: '' },
  ...[5, 4, 3, 2, 1].map((n) => ({ label: `${n} star${n === 1 ? '' : 's'}`, value: String(n) })),
];

interface Filters {
  status: string;
  rating: string;
}

const EMPTY_FILTERS: Filters = { status: '', rating: '' };

/**
 * Moderation of verified-purchase reviews.
 *
 * The one action here is HIDE (or restore), always with a reason. Nothing is
 * deleted: a hidden review drops out of the product page and out of the
 * product's average, the author still sees it marked hidden, and restoring it
 * puts both back exactly. Every decision lands in the audit log as
 * `review.hide` / `review.unhide` with the reason typed below.
 *
 * Filtering and paging happen on the server (`?status=&rating=&page=`); the
 * same filters are re-applied locally only so the sample rows behave when the
 * endpoint cannot be reached.
 */
export function ReviewsTab() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminReviewRow | null>(null);
  const [reason, setReason] = useState('');

  const params = useMemo(
    () => cleanParams({ status: filters.status, rating: filters.rating, page, limit: LIMIT }),
    [filters.status, filters.rating, page],
  );

  const { rows, meta, loading, isSample, refetch } = useSourcedList<AdminReviewRow>(
    ENDPOINT,
    params,
    REVIEWS_FIXTURE,
  );

  const visibility = useAdminMutation<{ hidden: boolean; reason: string }, AdminReviewRow>(
    `${ENDPOINT}/:id/visibility`,
    'PATCH',
  );

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filters.status === 'visible' && row.isHidden) return false;
        if (filters.status === 'hidden' && !row.isHidden) return false;
        if (filters.rating !== '' && String(row.rating) !== filters.rating) return false;
        return true;
      }),
    [rows, filters.status, filters.rating],
  );

  // Live: the server already paged. Sample: page the fixture locally.
  const visible = isSample ? paginate(filtered, page, LIMIT) : filtered;
  const pages = isSample ? pageCount(filtered.length, LIMIT) : Math.max(meta.pages, 1);

  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  function close() {
    setTarget(null);
    setReason('');
    visibility.reset();
  }

  async function apply() {
    if (target === null || !reasonOk) return;
    const done = await visibility.mutate(
      { hidden: !target.isHidden, reason: trimmed },
      { params: { id: target.id } },
    );
    if (done !== null) {
      close();
      refetch();
    }
  }

  return (
    <>
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <FilterBar
        filters={[
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'rating', label: 'Rating', type: 'select', options: RATING_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({ status: next.status ?? '', rating: next.rating ?? '' });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: AdminReviewRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No review matches those filters."
        page={page}
        pageCount={pages}
        onPageChange={setPage}
        columns={[
          {
            key: 'product',
            header: 'Product',
            render: (row: AdminReviewRow) => (
              <span className={styles.twoLine}>
                <span className={styles.strong}>{row.productName}</span>
                <span className={styles.subtle}>{row.storeName}</span>
              </span>
            ),
          },
          {
            key: 'rating',
            header: 'Rating',
            width: '6rem',
            align: 'right',
            render: (row: AdminReviewRow) => (
              <span className={styles.num} aria-label={`${row.rating} out of 5`}>
                {row.rating} ★
              </span>
            ),
          },
          {
            key: 'review',
            header: 'Review',
            render: (row: AdminReviewRow) => (
              <span className={styles.twoLine}>
                <span>
                  {row.comment ?? <span className={styles.nullish}>no comment</span>}
                </span>
                <span className={styles.subtle}>
                  {row.authorName} · <RelativeTime value={row.createdAt} />
                  {row.editedAt !== null ? ' · edited' : ''}
                </span>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: '11rem',
            render: (row: AdminReviewRow) => (
              <span className={styles.twoLine}>
                <StatusPill status={row.isHidden ? 'hidden' : 'visible'} kind="review" />
                {row.isHidden && row.hiddenReason !== null ? (
                  <span className={styles.subtle}>{row.hiddenReason}</span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: '7rem',
            render: (row: AdminReviewRow) => (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                disabled={isSample}
                onClick={() => setTarget(row)}
              >
                {row.isHidden ? 'Unhide' : 'Hide'}
              </button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={target !== null}
        loading={visibility.loading}
        confirmDisabled={!reasonOk}
        destructive={target?.isHidden === false}
        title={target?.isHidden === true ? 'Restore this review?' : 'Hide this review?'}
        confirmLabel={target?.isHidden === true ? 'Unhide' : 'Hide'}
        onCancel={close}
        onConfirm={() => void apply()}
        body={
          target === null ? null : (
            <>
              <p>
                {target.isHidden
                  ? `${target.authorName}'s review of ${target.productName} will be public again and count towards its rating.`
                  : `${target.authorName}'s review of ${target.productName} will disappear from the product page and from its average rating. The author will still see it, marked hidden.`}
              </p>
              <label className="adm-field">
                <span className="adm-field__label">
                  Reason (required, {REASON_MIN}–{REASON_MAX} characters — recorded in the audit
                  log)
                </span>
                <textarea
                  className="adm-input"
                  rows={3}
                  maxLength={REASON_MAX}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={
                    target.isHidden
                      ? 'Checked again — the number is a pack size, not a phone.'
                      : 'Contains a phone number.'
                  }
                  disabled={visibility.loading}
                  required
                />
              </label>
              {visibility.error !== null ? (
                <p className="adm-dialog__error">{visibility.error.friendlyMessage}</p>
              ) : null}
            </>
          )
        }
      />
    </>
  );
}
