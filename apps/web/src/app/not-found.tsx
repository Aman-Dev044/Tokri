import type { Metadata } from 'next';
import Link from 'next/link';
import { GroceryLoader } from '@mandi/design-system';

export const metadata: Metadata = {
  title: 'Aisle not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <div className="status-page__art" aria-hidden="true">
        <GroceryLoader.Inline size={120} label="" />
      </div>
      <p className="eyebrow">404 — nothing on this shelf</p>
      <h1 className="status-page__title">
        You have wandered into
        <br />
        <span className="status-page__accent">an aisle we do not stock.</span>
      </h1>
      <p className="status-page__body">
        The page you asked for is not here. It may have been renamed, or the link that
        sent you may be older than the shop.
      </p>
      <div className="status-page__cta">
        <Link href="/" className="mnd-btn mnd-btn--solid mnd-btn--lg">
          Back to the market
        </Link>
        <Link href="/#aisles" className="mnd-btn mnd-btn--ghost mnd-btn--lg">
          Browse the aisles
        </Link>
      </div>
    </main>
  );
}
