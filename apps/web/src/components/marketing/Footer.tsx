import Link from 'next/link';
import { AISLES } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';

/**
 * Footer. A Server Component - nothing here is interactive, so nothing here
 * needs to ship JavaScript.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mk-foot">
      <div className="mk-shell">
        <div className="mk-foot__top">
          <div className="mk-foot__brand">
            <p className="mk-foot__mark">
              {APP_NAME}
              <span className="mk-foot__mark-hi" aria-hidden="true">
                मंडी
              </span>
            </p>
            <p className="mk-foot__pitch">
              A market that changes colour as you walk through it — built for real
              Indian grocery, eight aisles at a time.
            </p>
          </div>

          <nav className="mk-foot__cols" aria-label="Footer">
            <div className="mk-foot__col">
              <h2>Shop</h2>
              <ul>
                {AISLES.slice(0, 4).map((a) => (
                  <li key={a.key}>
                    <Link href="/#aisles">{a.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-foot__col">
              <h2>More aisles</h2>
              <ul>
                {AISLES.slice(4).map((a) => (
                  <li key={a.key}>
                    <Link href="/#aisles">{a.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-foot__col">
              <h2>Partner</h2>
              <ul>
                <li>
                  <Link href="/#vendors">Sell on {APP_NAME}</Link>
                </li>
                <li>
                  <Link href="/#riders">Ride with {APP_NAME}</Link>
                </li>
                <li>
                  <Link href="/#how-it-works">How it works</Link>
                </li>
              </ul>
            </div>
            <div className="mk-foot__col">
              <h2>Account</h2>
              <ul>
                <li>
                  <Link href="/login">Log in</Link>
                </li>
                <li>
                  <Link href="/signup">Create an account</Link>
                </li>
                <li>
                  <Link href="/help">Help &amp; FAQ</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <hr className="mk-rule" />

        <div className="mk-foot__bottom">
          <p className="mk-foot__legal">
            © {year} {APP_NAME} · Built for Indian grocery · All prices in ₹ INR ·{' '}
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
          </p>
          <p className="mk-foot__strip" aria-hidden="true">
            {AISLES.map((a) => (
              <span key={a.key} style={{ ['--sw' as string]: `var(--aisle-${a.key})` }} />
            ))}
          </p>
        </div>
      </div>
    </footer>
  );
}
