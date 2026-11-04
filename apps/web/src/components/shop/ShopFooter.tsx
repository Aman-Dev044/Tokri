/**
 * The shop footer. Quiet, factual, and it states the two things a grocery
 * customer actually needs to find later: how to reach a human, and what
 * happens when an order goes wrong.
 *
 * Server Component — nothing here is interactive.
 */

import Link from 'next/link';
import { APP_NAME } from '@/config/brand';

export function ShopFooter() {
  return (
    <footer className="shop-foot">
      <div className="shell shop-foot__inner">
        <div>
          <p className="shop-foot__mark">{APP_NAME}</p>
          <p className="shop-foot__line">
            A market that changes colour as you walk through it.
          </p>
        </div>

        <nav className="shop-foot__nav" aria-label="Shop">
          <h2 className="shop-foot__title">Shop</h2>
          <Link href="/stores">Stores near you</Link>
          <Link href="/aisle/vegetables">Vegetables</Link>
          <Link href="/aisle/dairy">Dairy &amp; eggs</Link>
          <Link href="/orders">Your orders</Link>
        </nav>

        <nav className="shop-foot__nav" aria-label="About">
          <h2 className="shop-foot__title">About</h2>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#vendors">Sell on {APP_NAME}</Link>
          <Link href="/#riders">Deliver with {APP_NAME}</Link>
        </nav>

        <nav className="shop-foot__nav" aria-label="Help and policies">
          <h2 className="shop-foot__title">Help</h2>
          <Link href="/help">Help &amp; FAQ</Link>
          <Link href="/help#contact">Contact support</Link>
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
        </nav>

        <div className="shop-foot__nav">
          <h2 className="shop-foot__title">Good to know</h2>
          <p className="shop-foot__note">
            Cash on delivery is accepted where the store allows it, up to ₹2,000. If an item
            is out of stock after you order, the store part-fulfils and the missing lines are
            refunded automatically.
          </p>
        </div>
      </div>
    </footer>
  );
}
