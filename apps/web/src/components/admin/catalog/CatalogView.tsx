'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AdminPage } from '@/components/admin';

import styles from '../_shared-pages/pages.module.css';
import { AislesTab } from './AislesTab';
import { ProductsTab } from './ProductsTab';

type TabKey = 'aisles' | 'products';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'aisles', label: 'Aisles & categories' },
  { key: 'products', label: 'Products' },
];

/**
 * `/admin/catalog?tab=products&q=…` — the deep link `StockView`'s "Catalogue"
 * button already builds. Read once, from the URL this page loaded with: this
 * only steers the INITIAL tab and search box, never fights the tabs' own
 * `useState` on a later click.
 */
export function CatalogView() {
  const params = useSearchParams();
  const initialTab: TabKey = params.get('tab') === 'products' ? 'products' : 'aisles';
  const initialQuery = params.get('q') ?? '';

  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <AdminPage
      title="Catalog"
      description="The shape of the shop: eight aisles, the categories inside them, and every product across every vendor."
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
        {tab === 'aisles' ? <AislesTab /> : <ProductsTab initialQuery={initialQuery} />}
      </div>
    </AdminPage>
  );
}
