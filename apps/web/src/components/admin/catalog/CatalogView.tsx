'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AdminPage } from '@/components/admin';

import styles from '../_shared-pages/pages.module.css';
import { AislesTab } from './AislesTab';
import { ProductsTab } from './ProductsTab';
import { ReviewsTab } from './ReviewsTab';

type TabKey = 'aisles' | 'products' | 'reviews';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'aisles', label: 'Aisles & categories' },
  { key: 'products', label: 'Products' },
  { key: 'reviews', label: 'Reviews' },
];

/**
 * `/admin/catalog?tab=products&q=…` — the deep link `StockView`'s "Catalogue"
 * button already builds. Read once, from the URL this page loaded with: this
 * only steers the INITIAL tab and search box, never fights the tabs' own
 * `useState` on a later click.
 */
export function CatalogView() {
  const params = useSearchParams();
  const requested = params.get('tab');
  const initialTab: TabKey =
    requested === 'products' || requested === 'reviews' ? requested : 'aisles';
  const initialQuery = params.get('q') ?? '';

  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <AdminPage
      title="Catalog"
      description="The shape of the shop: nine aisles, the categories inside them, every product across every vendor, and what customers say about them."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Catalog', href: '/admin/catalog' },
      ]}
    >
      <div className={styles.tabs} role="tablist" aria-label="Catalog sections">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`catalog-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`catalog-panel-${entry.key}`}
            className={styles.tab}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        Both panels are mounted lazily rather than hidden, so the products
        query is not fired until someone actually opens that tab.
      */}
      <div
        role="tabpanel"
        id={`catalog-panel-${tab}`}
        aria-labelledby={`catalog-tab-${tab}`}
        className={styles.enter}
        key={tab}
      >
        {tab === 'aisles' ? (
          <AislesTab />
        ) : tab === 'products' ? (
          <ProductsTab initialQuery={initialQuery} />
        ) : (
          <ReviewsTab />
        )}
      </div>
    </AdminPage>
  );
}
