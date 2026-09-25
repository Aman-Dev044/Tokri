import Link from 'next/link';
import { AISLES } from '@mandi/design-system';

/**
 * Footer. A Server Component - nothing here is interactive, so nothing here
 * needs to ship JavaScript.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="foot bleed">
      <div className="shell">
        <div className="foot__top">
          <div className="foot__brand">
            <p className="foot__mark">
              Mandi
              <span className="foot__mark-hi" aria-hidden="true">
                मंडी
              </span>
            </p>
            <p className="foot__pitch">
              A market that changes colour as you walk through it, and changes light as
              the day passes.
            </p>
          </div>

          <nav className="foot__cols" aria-label="Footer">
            <div className="foot__col">
              <h2 className="foot__col-head eyebrow">Shop</h2>
              <ul>
                {AISLES.slice(0, 4).map((a) => (
                  <li key={a.key}>
                    <Link href="/#aisles">{a.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="foot__col">
              <h2 className="foot__col-head eyebrow">More aisles</h2>
              <ul>
                {AISLES.slice(4).map((a) => (
                  <li key={a.key}>
                    <Link href="/#aisles">{a.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="foot__col">
              <h2 className="foot__col-head eyebrow">Partner</h2>
              <ul>
                <li>
                  <Link href="/#vendors">Sell on Mandi</Link>
                </li>
                <li>
                  <Link href="/#riders">Ride with Mandi</Link>
                </li>
                <li>
                  <Link href="/#how-it-works">How it works</Link>
                </li>
              </ul>
            </div>
            <div className="foot__col">
              <h2 className="foot__col-head eyebrow">Account</h2>
              <ul>
                <li>
                  <Link href="/login">Log in</Link>
                </li>
                <li>
                  <Link href="/signup">Create an account</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <hr className="mnd-rule" />

        <div className="foot__bottom">
          <p className="mono foot__legal">
            © {year} Mandi · Built for Indian grocery · All prices in ₹ INR
          </p>
          <p className="foot__aisle-strip" aria-hidden="true">
            {AISLES.map((a) => (
              <span key={a.key} style={{ background: a.swatch }} />
            ))}
          </p>
        </div>
      </div>
    </footer>
  );
}
