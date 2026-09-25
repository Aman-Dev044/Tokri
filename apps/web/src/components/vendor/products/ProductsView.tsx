'use client';

/**
 * The catalogue.
 *
 * A table for finding things and a drawer for changing one thing, with the
 * customer's own card rendered live beside the fields (see ProductPreviewCard —
 * it explains why).
 *
 * ── WHAT THIS SCREEN DELIBERATELY CANNOT DO ─────────────────────────────────
 * Set stock. Stock lives only in the inventory collection (plan §5.2) and is
 * only ever moved by a DELTA (`PATCH /vendor/inventory/:productId`). The stock
 * column here is read-only and links to the inventory screen, because a second
 * writable copy of a quantity is how oversell bugs are born.
 *
 * ── IMAGES ──────────────────────────────────────────────────────────────────
 * Resized to ≤1600px and re-encoded as WebP in the browser, then PUT straight
 * to S3 with a presigned URL (see lib/vendor/image.ts). S3 is not configured
 * yet, so the presign call is expected to fail — and it fails into a plain
 * sentence, with the product still saveable without a photo. A wiring gap must
 * never look like a broken screen.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AdminPage,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  EmptyState,
  FilterBar,
  IconClose,
  IconInbox,
  IconPlus,
  Money,
  Toolbar,
  type Column,
  type FilterDef,
  type FilterValues,
} from '@/components/admin';
import { useDebounced, useVendorMutation, useVendorQuery } from '@/hooks';
import { isAisleKey } from '@mandi/design-system';
import { ImageUploadError, formatBytes, uploadProductImage } from '@/lib/vendor/image';
import type {
  Paged,
  ProductDraft,
  ProductUnit,
  VendorCategory,
  VendorProduct,
} from '@/lib/vendor/types';
import { ProductPreviewCard } from '../ProductPreviewCard';
import { Field, RupeeInput } from '../primitives';

const UNITS: readonly ProductUnit[] = ['kg', 'g', 'l', 'ml', 'piece', 'pack'];
const LIMIT = 20;

const EMPTY_DRAFT: ProductDraft = {
  name: '',
  description: '',
  sku: '',
  brand: '',
  categoryId: '',
  images: [],
  unit: 'kg',
  unitValue: 1,
  mrp: 0,
  price: 0,
  isActive: true,
};

interface Filters {
  q: string;
  categoryId: string;
  isActive: string;
  lowStock: string;
}

const EMPTY_FILTERS: Filters = { q: '', categoryId: 'all', isActive: 'all', lowStock: 'all' };

export function ProductsView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounced(filters.q, 300);

  const categories = useVendorQuery<VendorCategory[]>('/vendor/categories');

  const params = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      categoryId: filters.categoryId === 'all' ? undefined : filters.categoryId,
      isActive: filters.isActive === 'all' ? undefined : filters.isActive,
      lowStock: filters.lowStock === 'true' ? 'true' : undefined,
      page,
      limit: LIMIT,
    }),
    [debouncedQuery, filters.categoryId, filters.isActive, filters.lowStock, page],
  );

  const products = useVendorQuery<Paged<VendorProduct>>('/vendor/products', params);

  /* ---- the drawer ---- */
  const [editing, setEditing] = useState<VendorProduct | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [deleting, setDeleting] = useState<VendorProduct | null>(null);

  const create = useVendorMutation<ProductDraft, VendorProduct>('/vendor/products', 'POST');
  const update = useVendorMutation<ProductDraft, VendorProduct>('/vendor/products/:id', 'PUT');
  const remove = useVendorMutation<never, void>('/vendor/products/:id', 'DELETE');

  const openCreate = () => {
    const first = categories.data?.[0];
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT, categoryId: first?.id ?? '' });
    setDrawerOpen(true);
  };

  const openEdit = (product: VendorProduct) => {
    setEditing(product);
    setDraft({
      id: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      brand: product.brand,
      categoryId: product.categoryId,
      images: [...product.images],
      unit: product.unit,
      unitValue: product.unitValue,
      mrp: product.mrp,
      price: product.price,
      isActive: product.isActive,
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    create.reset();
    update.reset();
  };

  const save = () => {
    const done = () => {
      closeDrawer();
      products.refetch();
    };
    if (editing) {
      void update.mutate(draft, {
        params: { id: editing.id },
        invalidate: ['/vendor/products', '/vendor/inventory'],
        onSuccess: done,
      });
    } else {
      void create.mutate(draft, {
        invalidate: ['/vendor/products', '/vendor/inventory'],
        onSuccess: done,
      });
    }
  };

  /* ---- table ---- */
  const filterDefs: FilterDef[] = [
    { key: 'q', label: 'Search', type: 'search', placeholder: 'Name, brand or SKU…' },
    {
      key: 'categoryId',
      label: 'Category',
      type: 'select',
      options: [
        { label: 'All categories', value: 'all' },
        ...(categories.data ?? []).map((category) => ({
          label: category.name,
          value: category.id,
        })),
      ],
    },
    {
      key: 'isActive',
      label: 'Listed',
      type: 'select',
      options: [
        { label: 'Listed and unlisted', value: 'all' },
        { label: 'Listed only', value: 'true' },
        { label: 'Unlisted only', value: 'false' },
      ],
    },
    {
      key: 'lowStock',
      label: 'Stock',
      type: 'select',
      options: [
        { label: 'Any stock level', value: 'all' },
        { label: 'Low or out of stock', value: 'true' },
      ],
    },
  ];

  const columns: Column<VendorProduct>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <span>
          <strong>{row.name}</strong>
          <br />
          <span className="adm-dim">
            {row.brand} · {row.unitValue} {row.unit}
          </span>
        </span>
      ),
    },
    { key: 'sku', header: 'SKU', numeric: true },
    { key: 'categoryName', header: 'Category' },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.price} />,
    },
    {
      key: 'mrp',
      header: 'MRP',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.mrp} />,
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      numeric: true,
      render: (row) => {
        if (row.stock === undefined) return '—';
        const level =
          row.stock <= 0 ? 'out' : row.stock <= (row.lowStockThreshold ?? 0) ? 'low' : 'ok';
        return (
          <Link href="/vendor/inventory" className="ven-stock" data-level={level}>
            <span className="ven-stock__n">{row.stock}</span>
            <span className="adm-sr">
              {level === 'out' ? 'out of stock' : level === 'low' ? 'low stock' : 'in stock'}
            </span>
          </Link>
        );
      },
    },
    {
      key: 'isActive',
      header: 'Listed',
      render: (row) => (
        <span className="adm-pill" data-tone={row.isActive ? 'good' : 'neutral'}>
          <span className="adm-pill__glyph" aria-hidden="true" />
          {row.isActive ? 'Listed' : 'Hidden'}
        </span>
      ),
    },
  ];

  const fixturePaths = [
    products.isFixture ? '/vendor/products' : null,
    categories.isFixture ? '/vendor/categories' : null,
  ].filter((value): value is string => value !== null);

  const meta = products.data?.meta;
  const saveError = (editing ? update.error : create.error)?.friendlyMessage ?? null;

  return (
    <AdminPage
      title="Products"
      description="Your catalogue. Prices and photos here; quantities live on the inventory screen."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <button type="button" className="adm-btn adm-btn--primary" onClick={openCreate}>
          <IconPlus />
          Add product
        </button>
      }
    >
      <Toolbar>
        <FilterBar
          filters={filterDefs}
          values={filters}
          onChange={(values: FilterValues) => {
            setPage(1);
            setFilters({
              q: values['q'] ?? '',
              categoryId: values['categoryId'] ?? 'all',
              isActive: values['isActive'] ?? 'all',
              lowStock: values['lowStock'] ?? 'all',
            });
          }}
          onReset={() => {
            setPage(1);
            setFilters(EMPTY_FILTERS);
          }}
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={products.data?.data ?? []}
        loading={products.loading && !products.hasLoadedOnce}
        rowKey={(row) => row.id}
        onRowClick={openEdit}
        page={meta?.page}
        pageCount={meta?.pages}
        total={meta?.total}
        onPageChange={setPage}
        empty={
          <EmptyState
            title="No products match"
            body="Clear the filters, or add the first product in this shop."
            icon={<IconInbox />}
            action={
              <button type="button" className="adm-btn adm-btn--primary" onClick={openCreate}>
                Add product
              </button>
            }
          />
        }
      />

      <DetailDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editing ? editing.name : 'New product'}
        subtitle={editing ? `SKU ${editing.sku}` : 'It appears in the shop as soon as you list it.'}
        width="min(760px, 96vw)"
        actions={
          <>
            {editing ? (
              <button
                type="button"
                className="adm-btn adm-btn--danger"
                onClick={() => setDeleting(editing)}
              >
                Delete
              </button>
            ) : null}
            <span className="adm-toolbar__spacer" />
            <button type="button" className="adm-btn" onClick={closeDrawer}>
              Cancel
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              onClick={save}
              disabled={create.loading || update.loading || draft.name.trim() === ''}
            >
              {create.loading || update.loading ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </button>
          </>
        }
      >
        <ProductForm
          draft={draft}
          onChange={setDraft}
          categories={categories.data ?? []}
          productId={editing?.id ?? null}
          error={saveError}
        />
      </DetailDrawer>

      <ConfirmDialog
        open={deleting !== null}
        destructive
        title={`Delete ${deleting?.name ?? ''}?`}
        confirmLabel="Delete product"
        loading={remove.loading}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void remove.mutate(undefined, {
            params: { id: deleting.id },
            invalidate: ['/vendor/products', '/vendor/inventory'],
            onSuccess: () => {
              setDeleting(null);
              closeDrawer();
              products.refetch();
            },
          });
        }}
        body={
          <p>
            Past orders keep their own copy of this product, so history is not affected. If you
            only want it off the shop for now, cancel and untick “Listed” instead — that is
            reversible and this is not.
          </p>
        }
      />
    </AdminPage>
  );
}

/* ================================================================== */
/* The form                                                            */
/* ================================================================== */

function ProductForm({
  draft,
  onChange,
  categories,
  productId,
  error,
}: {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
  categories: VendorCategory[];
  productId: string | null;
  error: string | null;
}) {
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const category = categories.find((candidate) => candidate.id === draft.categoryId);
  const aisleKey = category && isAisleKey(category.aisleKey) ? category.aisleKey : 'vegetables';

  return (
    <div className="adm-grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
      <div className="ven-form">
        {error ? (
          <p className="ven-field__error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="Name" hint="What a customer searches for. Brand goes in its own field.">
          {(id) => (
            <input
              id={id}
              className="ven-input"
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              maxLength={120}
            />
          )}
        </Field>

        <div className="ven-form__row">
          <Field label="Brand">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                value={draft.brand}
                onChange={(event) => set('brand', event.target.value)}
                maxLength={60}
              />
            )}
          </Field>

          <Field label="SKU" hint="Your own code. Must be unique in this shop.">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                value={draft.sku}
                onChange={(event) => set('sku', event.target.value)}
                maxLength={40}
              />
            )}
          </Field>
        </div>

        <Field label="Category" hint="Sets which aisle — and which colour — the product lives in.">
          {(id) => (
            <select
              id={id}
              className="ven-select"
              value={draft.categoryId}
              onChange={(event) => set('categoryId', event.target.value)}
            >
              <option value="">Choose a category…</option>
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="ven-form__row">
          <Field label="Pack size">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                data-num="true"
                type="number"
                min={0}
                step="0.01"
                value={draft.unitValue}
                onChange={(event) => set('unitValue', Number(event.target.value) || 0)}
              />
            )}
          </Field>

          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                className="ven-select"
                value={draft.unit}
                onChange={(event) => set('unit', event.target.value as ProductUnit)}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="ven-form__row">
          <Field label="MRP (₹)" hint="Printed price. Shown struck through when you discount.">
            {(id) => (
              <RupeeInput id={id} value={draft.mrp} onChange={(paise) => set('mrp', paise)} />
            )}
          </Field>

          <Field
            label="Selling price (₹)"
            hint="What the customer pays."
            error={draft.mrp > 0 && draft.price > draft.mrp ? 'Higher than the MRP.' : undefined}
          >
            {(id) => (
              <RupeeInput id={id} value={draft.price} onChange={(paise) => set('price', paise)} />
            )}
          </Field>
        </div>

        <Field label="Description">
          {(id) => (
            <textarea
              id={id}
              className="ven-textarea"
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              maxLength={600}
            />
          )}
        </Field>

        <label className="ven-switch">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) => set('isActive', event.target.checked)}
          />
          <span>
            <strong>Listed</strong> — customers can see and order it
          </span>
        </label>

        <ImageTray
          productId={productId}
          images={draft.images}
          onChange={(images) => set('images', images)}
        />
      </div>

      <ProductPreviewCard
        name={draft.name}
        brand={draft.brand}
        price={draft.price}
        mrp={draft.mrp}
        unit={draft.unit}
        unitValue={draft.unitValue}
        aisleKey={aisleKey}
        images={draft.images}
        isActive={draft.isActive}
      />
    </div>
  );
}

/* ================================================================== */
/* Images                                                              */
/* ================================================================== */

function ImageTray({
  productId,
  images,
  onChange,
}: {
  productId: string | null;
  images: string[];
  onChange: (images: string[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [localPreviews, setLocalPreviews] = useState<string[]>([]);

  // Blob URLs leak until revoked, and a vendor editing twenty products in one
  // session would pin twenty full-size bitmaps in memory.
  useEffect(
    () => () => {
      for (const url of localPreviews) URL.revokeObjectURL(url);
    },
    [localPreviews],
  );

  const onPick = async (file: File) => {
    setMessage(null);
    setNotConfigured(false);

    if (productId === null) {
      // The presign endpoint is per-product, so there is nothing to sign
      // against yet. Show the picture locally and say plainly what happens.
      const preview = URL.createObjectURL(file);
      setLocalPreviews((previous) => [...previous, preview]);
      onChange([...images, preview]);
      setMessage(
        'Shown locally only — save the product first, then re-add the photo so it can be uploaded.',
      );
      return;
    }

    try {
      setBusy('resizing');
      const result = await uploadProductImage(productId, file, (phase) => setBusy(phase));
      onChange([...images, result.url]);
      setMessage(
        `Uploaded — ${formatBytes(result.originalBytes)} resized to ${formatBytes(result.bytes)}.`,
      );
    } catch (cause) {
      if (cause instanceof ImageUploadError) {
        setMessage(cause.message);
        setNotConfigured(cause.notConfigured);
      } else {
        setMessage('That photo could not be uploaded.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ven-field">
      <span className="ven-field__label">Photos</span>

      <div className="ven-images">
        {images.map((url, index) => (
          <div className="ven-thumb" key={`${url}-${index}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- S3 and
                blob: URLs, no loader, unknown dimensions. */}
            <img src={url} alt={`Product photo ${index + 1}`} />
            <button
              type="button"
              className="ven-thumb__remove"
              onClick={() => onChange(images.filter((_, i) => i !== index))}
            >
              <IconClose />
              <span className="adm-sr">Remove photo {index + 1}</span>
            </button>
          </div>
        ))}

        <label className="adm-btn adm-btn--sm" style={{ alignSelf: 'center' }}>
          {busy === null ? 'Add photo' : busy === 'resizing' ? 'Resizing…' : busy === 'signing' ? 'Preparing…' : 'Uploading…'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onPick(file);
            }}
          />
        </label>
      </div>

      <span className="ven-field__hint">
        Resized to 1600px and converted to WebP on this device before upload — a 6MB phone photo
        becomes about 150KB, which is the difference between an upload that finishes and one that
        does not.
      </span>

      {message ? (
        <span className={notConfigured ? 'ven-field__hint' : 'ven-field__error'} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
