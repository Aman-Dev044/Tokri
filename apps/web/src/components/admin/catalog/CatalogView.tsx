'use client';

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

export function CatalogView() {
  const [tab, setTab] = useState<TabKey>('aisles');

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
        {tab === 'aisles' ? <AislesTab /> : <ProductsTab />}
      </div>
    </AdminPage>
  );
}
