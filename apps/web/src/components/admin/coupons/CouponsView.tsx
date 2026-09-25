'use client';

import { useMemo, useState } from 'react';

import {
  AdminPage,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  FilterBar,
  KpiTile,
  Money,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation, useDebounced } from '@/hooks';
import { formatCount, formatDate } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { useNow } from '../_shared-pages/useNow';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  type SortState,
} from '../_shared-pages/useSourced';
import {
  BLANK_COUPON,
  COUPON_STATE_LABEL,
  COUPONS_FIXTURE,
  couponState,
  type CouponDraft,
  type CouponRow,
  type CouponType,
} from './fixtures';

const ENDPOINT = '/admin/coupons';
const LIMIT = 12;

/** Built from the label map so a new state cannot be added and forgotten. */
const STATE_OPTIONS = [
  { label: 'Any state', value: '' },
  ...Object.entries(COUPON_STATE_LABEL).map(([value, label]) => ({ label, value })),
];

const TYPE_OPTIONS = [
  { label: 'Any type', value: '' },
  { label: 'Flat', value: 'flat' },
  { label: 'Percent', value: 'percent' },
];

interface Filters {
  q: string;
  state: string;
  type: string;
}

const EMPTY_FILTERS: Filters = { q: '', state: '', type: '' };

/* ------------------------------------------------------------------ */
/* Validation — a local mirror of the server's rules                   */
/* ------------------------------------------------------------------ */

type FieldKey =
  | 'code'
  | 'value'
  | 'minOrderPaise'
  | 'maxDiscountPaise'
  | 'usageLimit'
  | 'perUserLimit'
  | 'validFrom'
  | 'validTo';

type DraftErrors = Partial<Record<FieldKey, string>>;

/**
 * Deliberately a MIRROR, not the authority.
 *
 * The API re-validates every one of these rules and is the only thing that
 * decides whether a coupon is created. Checking here just means the admin
 * finds out before the round trip, and finds out per field rather than as one
 * opaque 422.
 */
function validate(draft: CouponDraft, others: readonly CouponRow[], usedCount: number): DraftErrors {
  const errors: DraftErrors = {};

  if (!/^[A-Z0-9]{4,20}$/.test(draft.code)) {
    errors.code = 'Four to twenty characters, A–Z and 0–9 only.';
  } else if (others.some((c) => c.code === draft.code)) {
    errors.code = 'A coupon with this code already exists.';
  }

  if (draft.type === 'percent') {
    if (!Number.isFinite(draft.value) || draft.value < 1 || draft.value > 100) {
      errors.value = 'A percentage between 1 and 100.';
    }
    // The rule that stops an uncapped percentage becoming an unbounded
    // liability on a large basket.
    if (draft.maxDiscountPaise === null || draft.maxDiscountPaise <= 0) {
      errors.maxDiscountPaise = 'A percent coupon must be capped. Set a maximum discount.';
    }
  } else if (!Number.isInteger(draft.value) || draft.value <= 0) {
    errors.value = 'A whole number of paise, greater than zero.';
  }

  if (!Number.isInteger(draft.minOrderPaise) || draft.minOrderPaise < 0) {
    errors.minOrderPaise = 'A whole number of paise, zero or more.';
  }

  if (draft.type === 'flat' && draft.minOrderPaise > 0 && draft.value > draft.minOrderPaise) {
    errors.value = 'The discount is larger than the minimum order it requires.';
  }

  if (draft.usageLimit !== null) {
    if (!Number.isInteger(draft.usageLimit) || draft.usageLimit < 1) {
      errors.usageLimit = 'Leave blank for unlimited, or set a whole number of one or more.';
    } else if (draft.usageLimit < usedCount) {
      errors.usageLimit = `Already redeemed ${formatCount(usedCount)} times — the limit cannot be lower.`;
    }
  }

  if (!Number.isInteger(draft.perUserLimit) || draft.perUserLimit < 1) {
    errors.perUserLimit = 'At least one per customer.';
  }

  if (draft.validFrom === '') errors.validFrom = 'Pick a start date.';
  if (draft.validTo === '') errors.validTo = 'Pick an end date.';
  if (draft.validFrom !== '' && draft.validTo !== '' && draft.validFrom >= draft.validTo) {
    errors.validTo = 'The window must end after it starts.';
  }

  return errors;
}

/* ------------------------------------------------------------------ */

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span className={styles.twoLine}>
        <span className={styles.num}>{formatCount(used)}</span>
        <span className={styles.subtle}>no limit</span>
      </span>
    );
  }

  const pct = limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const fillClass =
    pct >= 100 ? styles.progressFillCrit : pct >= 80 ? styles.progressFillWarn : '';

  return (
    <span className={styles.twoLine}>
      <span
        className={styles.progress}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${formatCount(used)} of ${formatCount(limit)} redemptions used`}
      >
        <span
          className={`${styles.progressFill} ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={styles.progressLabel}>
        {formatCount(used)} / {formatCount(limit)}
      </span>
    </span>
  );
}

function isoDatePart(value: string): string {
  return value === '' ? '' : value.slice(0, 10);
}

export function CouponsView() {
  const now = useNow();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'code', dir: 'asc' });

  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [draft, setDraft] = useState<CouponDraft | null>(null);
  const [deleting, setDeleting] = useState<CouponRow | null>(null);

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        state: filters.state,
        type: filters.type,
        page,
        limit: LIMIT,
      }),
    [debouncedQ, filters.state, filters.type, page],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<CouponRow>(
    ENDPOINT,
    params,
    COUPONS_FIXTURE,
  );

  const save = useAdminMutation<CouponDraft, CouponRow>(
    editing === null ? ENDPOINT : `${ENDPOINT}/${editing.id}`,
    editing === null ? 'POST' : 'PATCH',
  );
  const remove = useAdminMutation<Record<string, never>, void>(
    deleting === null ? ENDPOINT : `${ENDPOINT}/${deleting.id}`,
    'DELETE',
  );

  const filtered = useMemo(() => {
    const clock = now ?? 0;
    const matched = rows.filter((row) => {
      if (!matchesSearch([row.code, row.vendorName ?? undefined], debouncedQ)) return false;
      if (filters.type !== '' && row.type !== filters.type) return false;
      if (filters.state !== '' && now !== null && couponState(row, clock) !== filters.state) {
        return false;
      }
      return true;
    });
    return sortRows(matched, sort, (row, key) => {
      switch (key) {
        case 'code':
          return row.code;
        case 'type':
          return row.type;
        case 'value':
          return row.value;
        case 'minOrder':
          return row.minOrderPaise;
        case 'usage':
          return row.usageLimit === null ? row.usedCount : row.usedCount / row.usageLimit;
        case 'window':
          return Date.parse(row.validTo);
        default:
          return null;
      }
    });
  }, [rows, debouncedQ, filters.type, filters.state, sort, now]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const kpis = useMemo(() => {
    const clock = now ?? 0;
    let live = 0;
    let exhausted = 0;
    let redemptions = 0;
    for (const row of rows) {
      redemptions += row.usedCount;
      if (now === null) continue;
      const state = couponState(row, clock);
      if (state === 'live') live += 1;
      if (state === 'exhausted') exhausted += 1;
    }
    return { total: rows.length, live, exhausted, redemptions };
  }, [rows, now]);

  const others = rows.filter((c) => c.id !== editing?.id);
  const errors = draft === null ? {} : validate(draft, others, editing?.usedCount ?? 0);
  const canSave = draft !== null && Object.keys(errors).length === 0;

  function patch(next: Partial<CouponDraft>) {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...next }));
  }

  function openNew() {
    setEditing(null);
    setDraft({ ...BLANK_COUPON });
  }

  function openEdit(row: CouponRow) {
    setEditing(row);
    setDraft({
      code: row.code,
      type: row.type,
      value: row.value,
      minOrderPaise: row.minOrderPaise,
      maxDiscountPaise: row.maxDiscountPaise,
      usageLimit: row.usageLimit,
      perUserLimit: row.perUserLimit,
      validFrom: isoDatePart(row.validFrom),
      validTo: isoDatePart(row.validTo),
      isActive: row.isActive,
    });
  }

  function close() {
    setEditing(null);
    setDraft(null);
  }

  async function submit() {
    if (draft === null || !canSave) return;
    await save.mutate(draft);
    close();
    refetch();
  }

  async function confirmDelete() {
    if (deleting === null) return;
    await remove.mutate({});
    setDeleting(null);
    refetch();
  }

  return (
    <AdminPage
      title="Coupons"
      description="Discount codes, their windows and how much of each has been burnt through."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Coupons', href: '/admin/coupons' },
      ]}
      actions={
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openNew}>
          New coupon
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Coupons"
          value={kpis.total}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Live now"
          value={kpis.live}
          tone="good"
          loading={loading || now === null}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Exhausted"
          value={kpis.exhausted}
          tone={kpis.exhausted > 0 ? 'warn' : 'neutral'}
          loading={loading || now === null}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Total redemptions"
          value={kpis.redemptions}
          loading={loading}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          { key: 'state', label: 'State', type: 'select', options: STATE_OPTIONS },
          { key: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
            state: next.state ?? '',
            type: next.type ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: CouponRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No coupon matches those filters."
        onRowClick={openEdit}
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'code',
            header: 'Code',
            sortable: true,
            render: (row: CouponRow) => (
              <span className={styles.twoLine}>
                <span className={`${styles.mono} ${styles.strong}`}>{row.code}</span>
                <span className={styles.subtle}>
                  {row.vendorName ?? 'platform-wide'} · {row.perUserLimit} per customer
                </span>
              </span>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            width: '6rem',
            sortable: true,
            render: (row: CouponRow) => (
              <span className={styles.tag}>{row.type === 'flat' ? 'Flat' : 'Percent'}</span>
            ),
          },
          {
            key: 'value',
            header: 'Value',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: CouponRow) =>
              row.type === 'flat' ? (
                <Money value={row.value} />
              ) : (
                <span className={styles.twoLine}>
                  <span className={styles.num}>{row.value}%</span>
                  <span className={styles.subtle}>
                    max{' '}
                    {row.maxDiscountPaise === null ? (
                      <span className={styles.crit}>uncapped</span>
                    ) : (
                      <Money value={row.maxDiscountPaise} />
                    )}
                  </span>
                </span>
              ),
          },
          {
            key: 'minOrder',
            header: 'Min order',
            align: 'right',
            width: '8rem',
            sortable: true,
            render: (row: CouponRow) =>
              row.minOrderPaise === 0 ? (
                <span className={styles.muted}>none</span>
              ) : (
                <Money value={row.minOrderPaise} />
              ),
          },
          {
            key: 'usage',
            header: 'Usage',
            width: '10rem',
            sortable: true,
            render: (row: CouponRow) => <UsageBar used={row.usedCount} limit={row.usageLimit} />,
          },
          {
            key: 'window',
            header: 'Window',
            width: '12rem',
            sortable: true,
            render: (row: CouponRow) => (
              <span className={styles.mono}>
                {formatDate(row.validFrom, 'day')} – {formatDate(row.validTo, 'day')}
              </span>
            ),
          },
          {
            key: 'state',
            header: 'State',
            width: '8rem',
            render: (row: CouponRow) =>
              // The state is derived, not stored: `isActive: true` on a window
              // that closed yesterday is not "active".
              now === null ? (
                <span className={styles.muted}>—</span>
              ) : (
                <StatusPill status={couponState(row, now)} />
              ),
          },
        ]}
      />

      <DetailDrawer
        open={draft !== null}
        onClose={close}
        title={editing === null ? 'New coupon' : editing.code}
        subtitle={
          editing === null
            ? 'Validated here and again by the API — the API is the one that decides.'
            : `Redeemed ${formatCount(editing.usedCount)} times so far`
        }
        actions={
          <>
            {editing === null ? null : (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setDeleting(editing)}
              >
                Delete
              </button>
            )}
            <button type="button" className={styles.btn} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!canSave || save.loading}
              onClick={() => {
                void submit();
              }}
            >
              {save.loading ? 'Saving…' : editing === null ? 'Create coupon' : 'Save changes'}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <div className={`${styles.formGrid} ${styles.formGrid2}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-code">
                Code
              </label>
              <input
                id="cpn-code"
                className={`${styles.input} ${styles.inputNum} ${
                  errors.code === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.code}
                aria-invalid={errors.code !== undefined}
                autoComplete="off"
                onChange={(event) =>
                  patch({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                }
              />
              {errors.code === undefined ? (
                <span className={styles.fieldHint}>What the customer types at checkout.</span>
              ) : (
                <span className={styles.fieldError}>{errors.code}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-type">
                Type
              </label>
              <select
                id="cpn-type"
                className={styles.select}
                value={draft.type}
                onChange={(event) => {
                  const type = event.target.value as CouponType;
                  patch({
                    type,
                    // Switching to percent makes the cap mandatory; switching
                    // away makes it meaningless. Reset rather than carry a
                    // stale number across.
                    value: 0,
                    maxDiscountPaise: type === 'percent' ? draft.maxDiscountPaise : null,
                  });
                }}
              >
                <option value="flat">Flat amount off</option>
                <option value="percent">Percentage off</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-value">
                {draft.type === 'flat' ? 'Discount' : 'Percentage'}
                <span className={styles.labelHint}>
                  {draft.type === 'flat' ? ' — in paise' : ' — 1 to 100'}
                </span>
              </label>
              <input
                id="cpn-value"
                type="number"
                min={draft.type === 'flat' ? 1 : 1}
                max={draft.type === 'percent' ? 100 : undefined}
                step={draft.type === 'flat' ? 100 : 1}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.value === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.value}
                aria-invalid={errors.value !== undefined}
                onChange={(event) => patch({ value: Number.parseInt(event.target.value, 10) || 0 })}
              />
              {errors.value === undefined ? (
                <span className={styles.fieldHint}>
                  {draft.type === 'flat' ? (
                    <>
                      = <Money value={draft.value} /> off the order
                    </>
                  ) : (
                    `${draft.value}% off, up to the cap below`
                  )}
                </span>
              ) : (
                <span className={styles.fieldError}>{errors.value}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-max">
                Maximum discount
                <span className={styles.labelHint}>
                  {draft.type === 'percent' ? ' — required, in paise' : ' — not used for flat'}
                </span>
              </label>
              <input
                id="cpn-max"
                type="number"
                min={0}
                step={100}
                disabled={draft.type === 'flat'}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.maxDiscountPaise === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.maxDiscountPaise ?? ''}
                aria-invalid={errors.maxDiscountPaise !== undefined}
                onChange={(event) =>
                  patch({
                    maxDiscountPaise:
                      event.target.value === ''
                        ? null
                        : Number.parseInt(event.target.value, 10) || 0,
                  })
                }
              />
              {errors.maxDiscountPaise === undefined ? (
                <span className={styles.fieldHint}>
                  {draft.maxDiscountPaise === null ? (
                    'An uncapped percentage is an unbounded liability.'
                  ) : (
                    <>
                      Never more than <Money value={draft.maxDiscountPaise} />
                    </>
                  )}
                </span>
              ) : (
                <span className={styles.fieldError}>{errors.maxDiscountPaise}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-min">
                Minimum order
                <span className={styles.labelHint}> — in paise</span>
              </label>
              <input
                id="cpn-min"
                type="number"
                min={0}
                step={100}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.minOrderPaise === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.minOrderPaise}
                onChange={(event) =>
                  patch({ minOrderPaise: Number.parseInt(event.target.value, 10) || 0 })
                }
              />
              {errors.minOrderPaise === undefined ? (
                <span className={styles.fieldHint}>
                  {draft.minOrderPaise === 0 ? (
                    'No minimum.'
                  ) : (
                    <>
                      Basket must reach <Money value={draft.minOrderPaise} />
                    </>
                  )}
                </span>
              ) : (
                <span className={styles.fieldError}>{errors.minOrderPaise}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-limit">
                Usage limit
                <span className={styles.labelHint}> — blank for unlimited</span>
              </label>
              <input
                id="cpn-limit"
                type="number"
                min={1}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.usageLimit === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.usageLimit ?? ''}
                onChange={(event) =>
                  patch({
                    usageLimit:
                      event.target.value === ''
                        ? null
                        : Number.parseInt(event.target.value, 10) || 0,
                  })
                }
              />
              {errors.usageLimit === undefined ? null : (
                <span className={styles.fieldError}>{errors.usageLimit}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-per-user">
                Per customer
              </label>
              <input
                id="cpn-per-user"
                type="number"
                min={1}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.perUserLimit === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.perUserLimit}
                onChange={(event) =>
                  patch({ perUserLimit: Number.parseInt(event.target.value, 10) || 0 })
                }
              />
              {errors.perUserLimit === undefined ? null : (
                <span className={styles.fieldError}>{errors.perUserLimit}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-from">
                Valid from
              </label>
              <input
                id="cpn-from"
                type="date"
                className={`${styles.input} ${styles.inputNum} ${
                  errors.validFrom === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.validFrom}
                onChange={(event) => patch({ validFrom: event.target.value })}
              />
              {errors.validFrom === undefined ? null : (
                <span className={styles.fieldError}>{errors.validFrom}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cpn-to">
                Valid to
              </label>
              <input
                id="cpn-to"
                type="date"
                className={`${styles.input} ${styles.inputNum} ${
                  errors.validTo === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.validTo}
                onChange={(event) => patch({ validTo: event.target.value })}
              />
              {errors.validTo === undefined ? null : (
                <span className={styles.fieldError}>{errors.validTo}</span>
              )}
            </div>

            <div className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.checkRow}>
                <input
                  id="cpn-active"
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => patch({ isActive: event.target.checked })}
                />
                <label htmlFor="cpn-active" className={styles.label}>
                  Active
                  <span className={styles.labelHint}>
                    {' '}
                    — a disabled coupon is refused at checkout even inside its window.
                  </span>
                </label>
              </span>
            </div>

            {editing === null ? null : (
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <span className={styles.label}>Usage so far</span>
                <UsageBar used={editing.usedCount} limit={draft.usageLimit} />
              </div>
            )}

            {save.error === null || save.error === undefined ? null : (
              <p className={`${styles.fieldError} ${styles.fieldWide}`} role="alert">
                The coupon was not saved. Nothing changed.
              </p>
            )}
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this coupon?"
        body={
          deleting === null
            ? ''
            : deleting.usedCount > 0
              ? `${deleting.code} has already been redeemed ${formatCount(
                  deleting.usedCount,
                )} times. Deleting it does not reverse those discounts, and the orders that used it keep their pricing. Disabling it instead keeps the history intact.`
              : `${deleting.code} has never been redeemed and can be removed cleanly.`
        }
        confirmLabel="Delete"
        destructive
        loading={remove.loading}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleting(null)}
      />
    </AdminPage>
  );
}
