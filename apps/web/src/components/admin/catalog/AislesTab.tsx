'use client';

import { useMemo, useState } from 'react';
import { AISLES, type AisleKey } from '@mandi/design-system';

import {
  AdminSection,
  AisleDot,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation } from '@/hooks';
import { formatCount } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { cleanParams, useSourcedList } from '../_shared-pages/useSourced';
import { CATEGORIES_FIXTURE, type CategoryDraft, type CategoryRow } from './fixtures';

const ENDPOINT = '/admin/categories';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BLANK: CategoryDraft = {
  name: '',
  slug: '',
  aisleKey: 'fruits',
  sortOrder: 10,
  isActive: true,
};

interface DraftErrors {
  name?: string;
  slug?: string;
  sortOrder?: string;
}

/** Mirrors the server's category rules so the drawer fails fast, locally. */
function validate(draft: CategoryDraft, siblings: readonly CategoryRow[]): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.name.trim().length < 2) errors.name = 'Give the category a name.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) {
    errors.slug = 'Lowercase letters, digits and single hyphens only.';
  } else if (siblings.some((c) => c.slug === draft.slug)) {
    // `{ vendorId, slug }` is a unique index (plan §5.1).
    errors.slug = 'Another category already uses this slug.';
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0) {
    errors.sortOrder = 'Whole number, zero or more.';
  }
  return errors;
}

export function AislesTab() {
  const { rows, loading, isSample, refetch } = useSourcedList<CategoryRow>(
    ENDPOINT,
    cleanParams({ limit: 200 }),
    CATEGORIES_FIXTURE,
  );

  const [aisle, setAisle] = useState<AisleKey | null>(null);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  const save = useAdminMutation<CategoryDraft, CategoryRow>(ENDPOINT, 'POST');
  const remove = useAdminMutation<Record<string, never>, void>(ENDPOINT, 'DELETE');

  const counts = useMemo(() => {
    const map = new Map<string, { categories: number; products: number }>();
    for (const a of AISLES) map.set(a.key, { categories: 0, products: 0 });
    for (const row of rows) {
      const entry = map.get(row.aisleKey);
      if (entry === undefined) continue;
      entry.categories += 1;
      entry.products += row.productCount;
    }
    return map;
  }, [rows]);

  const shown = useMemo(
    () => (aisle === null ? rows : rows.filter((r) => r.aisleKey === aisle)),
    [rows, aisle],
  );

  const errors = draft === null ? {} : validate(draft, shown.filter((c) => c.id !== editing?.id));
  const canSave = draft !== null && Object.keys(errors).length === 0;

  function openNew() {
    setEditing(null);
    setDraft({ ...BLANK, aisleKey: aisle ?? 'fruits' });
  }

  function openEdit(row: CategoryRow) {
    setEditing(row);
    setDraft({
      name: row.name,
      slug: row.slug,
      aisleKey: row.aisleKey,
      sortOrder: row.sortOrder,
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
    <>
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <AdminSection title="Aisles">
        {/*
          The eight aisle hues appear here as identity swatches for a breakdown
          BY aisle — the one exception in plan §2.4. Nothing else on this
          surface is tinted, and `data-aisle` is never stamped.
        */}
        <div className={styles.aisleGrid}>
          {AISLES.map((a) => {
            const count = counts.get(a.key) ?? { categories: 0, products: 0 };
            const selected = aisle === a.key;
            return (
              <button
                key={a.key}
                type="button"
                className={`${styles.aisleCard} ${styles.enter}`}
                aria-pressed={selected}
                style={
                  selected ? { borderColor: a.swatch, borderLeftWidth: 3 } : { borderLeftWidth: 3 }
                }
                onClick={() => setAisle(selected ? null : a.key)}
              >
                <span className={styles.aisleCardHead}>
                  <AisleDot aisle={a.key} />
                  {a.name}
                </span>
                <span className={styles.aisleCardMeta}>
                  <span>{formatCount(count.categories)} categories</span>
                  <span>{formatCount(count.products)} products</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className={styles.legend}>
          {aisle === null
            ? 'Select an aisle to filter the categories below.'
            : 'Showing one aisle. Select it again to clear the filter.'}
        </p>
      </AdminSection>

      <AdminSection
        title={aisle === null ? 'All categories' : 'Categories in this aisle'}
        actions={
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openNew}>
            New category
          </button>
        }
      >
        <DataTable
          rowKey={(row: CategoryRow) => row.id}
          rows={shown}
          loading={loading}
          empty="No category here yet."
          onRowClick={openEdit}
          columns={[
            {
              key: 'name',
              header: 'Category',
              render: (row: CategoryRow) => (
                <span className={styles.rowWrap}>
                  <AisleDot aisle={row.aisleKey} />
                  <span className={styles.strong}>{row.name}</span>
                </span>
              ),
            },
            {
              key: 'slug',
              header: 'Slug',
              width: '12rem',
              render: (row: CategoryRow) => <span className={styles.mono}>{row.slug}</span>,
            },
            {
              key: 'scope',
              header: 'Scope',
              width: '14rem',
              render: (row: CategoryRow) =>
                row.vendorName === null ? (
                  <span className={styles.tag}>platform-global</span>
                ) : (
                  <span className={styles.truncate}>{row.vendorName}</span>
                ),
            },
            {
              key: 'productCount',
              header: 'Products',
              align: 'right',
              width: '7rem',
              render: (row: CategoryRow) => (
                <span className={styles.num}>{formatCount(row.productCount)}</span>
              ),
            },
            {
              key: 'sortOrder',
              header: 'Order',
              align: 'right',
              width: '5rem',
              render: (row: CategoryRow) => <span className={styles.num}>{row.sortOrder}</span>,
            },
            {
              key: 'isActive',
              header: 'Status',
              width: '7rem',
              render: (row: CategoryRow) => (
                <StatusPill status={row.isActive ? 'active' : 'inactive'} />
              ),
            },
          ]}
        />
      </AdminSection>

      <DetailDrawer
        open={draft !== null}
        onClose={close}
        title={editing === null ? 'New category' : editing.name}
        subtitle={
          editing === null
            ? 'Platform-global. Vendors inherit it unless they create their own.'
            : `${formatCount(editing.productCount)} products currently sit in this category`
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
              {save.loading ? 'Saving…' : editing === null ? 'Create' : 'Save changes'}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <div className={`${styles.formGrid} ${styles.formGrid2}`}>
            <div className={`${styles.field} ${styles.fieldWide}`}>
              <label className={styles.label} htmlFor="cat-name">
                Name
              </label>
              <input
                id="cat-name"
                className={`${styles.input} ${errors.name === undefined ? '' : styles.inputInvalid}`}
                value={draft.name}
                aria-invalid={errors.name !== undefined}
                onChange={(event) => {
                  const name = event.target.value;
                  setDraft((prev) =>
                    prev === null
                      ? prev
                      : {
                          ...prev,
                          name,
                          // Keep the slug in step while it is still untouched.
                          slug: editing === null ? slugify(name) : prev.slug,
                        },
                  );
                }}
              />
              {errors.name === undefined ? null : (
                <span className={styles.fieldError}>{errors.name}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cat-slug">
                Slug
              </label>
              <input
                id="cat-slug"
                className={`${styles.input} ${styles.inputNum} ${
                  errors.slug === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.slug}
                aria-invalid={errors.slug !== undefined}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev === null ? prev : { ...prev, slug: slugify(event.target.value) },
                  )
                }
              />
              {errors.slug === undefined ? (
                <span className={styles.fieldHint}>Unique per vendor. Appears in the URL.</span>
              ) : (
                <span className={styles.fieldError}>{errors.slug}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cat-aisle">
                Aisle
              </label>
              <select
                id="cat-aisle"
                className={styles.select}
                value={draft.aisleKey}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev === null
                      ? prev
                      : { ...prev, aisleKey: event.target.value as AisleKey }
                  )
                }
              >
                {AISLES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className={styles.fieldHint}>
                Drives the chromatic aisle colour in the shopping app.
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cat-sort">
                Sort order
              </label>
              <input
                id="cat-sort"
                type="number"
                min={0}
                step={10}
                className={`${styles.input} ${styles.inputNum} ${
                  errors.sortOrder === undefined ? '' : styles.inputInvalid
                }`}
                value={draft.sortOrder}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev === null
                      ? prev
                      : { ...prev, sortOrder: Number.parseInt(event.target.value, 10) || 0 },
                  )
                }
              />
              {errors.sortOrder === undefined ? (
                <span className={styles.fieldHint}>Lower sorts first.</span>
              ) : (
                <span className={styles.fieldError}>{errors.sortOrder}</span>
              )}
            </div>

            <div className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.checkRow}>
                <input
                  id="cat-active"
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev === null ? prev : { ...prev, isActive: event.target.checked },
                    )
                  }
                />
                <label htmlFor="cat-active" className={styles.label}>
                  Active
                  <span className={styles.labelHint}>
                    {' '}
                    — inactive categories stay in the data but disappear from browse.
                  </span>
                </label>
              </span>
            </div>

            {save.error === null || save.error === undefined ? null : (
              <p className={`${styles.fieldError} ${styles.fieldWide}`} role="alert">
                The category was not saved. Nothing changed.
              </p>
            )}
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this category?"
        body={
          deleting === null
            ? ''
            : deleting.productCount > 0
              ? `${deleting.name} still holds ${formatCount(
                  deleting.productCount,
                )} products. They will be left without a category and will stop appearing in browse until they are re-assigned.`
              : `${deleting.name} is empty and can be removed safely.`
        }
        confirmLabel="Delete"
        destructive
        loading={remove.loading}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
