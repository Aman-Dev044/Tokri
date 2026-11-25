import Image from 'next/image';
import Link from 'next/link';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE FRONT DOOR · "FOREST GOLD"
 * ════════════════════════════════════════════════════════════════════════
 *
 * A poster, centred: a huge uppercase headline whose second line drops to a
 * softer green, one yellow pill, and — carrying the middle of the page — the
 * food on a round plate inside a glowing gold orbit, with six glass feature
 * pills standing either side of it and a few tilted cards bobbing around
 * it. A wide glass panel closes the hero with a dotted globe and the line
 * the whole service is built on.
 *
 * ── It is still a SERVER component ──────────────────────────────────────
 * Every moving part here is CSS: the orbit breathes and carries a dot round
 * its ellipse, the seal turns, the cards bob, the globe's dots drift. None
 * of it needs state, so the largest and first-painted section of the site
 * ships no JavaScript — and all of it stops under `prefers-reduced-motion`.
 *
 * ── The numbers are real ────────────────────────────────────────────────
 * "from ₹28" is Amul Taaza at its seeded price, "about 22 minutes" is the
 * figure quoted everywhere else on this page, ₹2,000 is the real cash
 * ceiling and the 4-digit code is the real handover. A hero that invents a
 * claim is the first thing a visitor catches you on.
 */

/** Six facts this service actually keeps — three either side of the plate. */
const FEATS: ReadonlyArray<{ label: string; sub: string; icon: React.ReactNode }> = [
  {
    label: 'Picked today',
    sub: 'By a real shop near you',
    icon: <path d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z" />,
  },
  {
    label: 'About 22 minutes',
    sub: 'Shelf to your door',
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" strokeLinecap="round" />
      </>
    ),
  },
  {
    label: 'Nine aisles',
    sub: 'Fruit to frozen',
    icon: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  {
    label: 'Cash or online',
    sub: 'Cash on delivery to ₹2,000',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </>
    ),
  },
  {
    label: 'Code-locked handover',
    sub: 'A 4-digit code at the door',
    icon: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    label: 'Line-by-line refunds',
    sub: 'One missing lemon, one refund',
    icon: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

/** The photograph on the plate. */
const LEAD = { src: '/products/mango.jpg', alt: 'Alphonso mangoes on the branch' };

function Feat({ feat }: { feat: (typeof FEATS)[number] }) {
  return (
    <li className="mk-feat tkr-pill-row">
      <span className="mk-feat__badge tkr-badge-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          {feat.icon}
        </svg>
      </span>
      <span className="mk-feat__text">
        <span className="mk-feat__label">{feat.label}</span>
        <span className="mk-feat__sub">{feat.sub}</span>
      </span>
    </li>
  );
}

export function Hero() {
  return (
    <section className="mk-hero" id="top">
      {/* Forest light pooling behind the poster. Decorative only. */}
      <div className="mk-hero__wash" aria-hidden="true" />

      <div className="mk-shell mk-hero__grid">
        <div className="mk-hero__copy">
          <p className="mk-hero__eyebrow">
            <span className="tkr-live" aria-hidden="true" />
            मंडी · fresh · local
          </p>

          <h1 className="mk-hero__title tkr-mega">
            Fresh from the mandi,{' '}
            <span className="mk-hero__em tkr-mega__soft">
              to your door.
              {/* A drawn swash, not a border: it has the wobble of a pen,
                  which a straight 2px rule cannot imitate. It draws itself
                  in once the headline has landed. */}
              <svg
                className="mk-hero__swash"
                viewBox="0 0 320 14"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M3 9.5C54 4.5 120 2.5 186 4.5c47 1.4 90 3.6 131 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength={1}
                />
              </svg>
            </span>
          </h1>

          <p className="mk-hero__lede">
            Not a warehouse with a catalogue stapled on. It is the kirana, the dairy
            and the bakery already on your street — picked by a real shop near you and
            handed over in about twenty minutes.
          </p>

          <div className="mk-hero__cta">
            <Link className="tkr-cta mk-hero__go" href="/shop">
              Start shopping
              <svg viewBox="0 0 24 24" aria-hidden="true" className="tkr-cta__arrow">
                <path
                  d="M5 12h13m0 0-5-5m5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link className="mk-pill mk-pill--outline" href="/#how-it-works">
              See how it works
            </Link>
          </div>
        </div>

        {/* ── the stage: pills · plate in an orbit · pills ─────────────── */}
        <div className="mk-stage">
          <ul className="mk-feats mk-feats--left">
            {FEATS.slice(0, 3).map((feat) => (
              <Feat feat={feat} key={feat.label} />
            ))}
          </ul>

          <div className="mk-art">
            <span className="mk-art__orbit tkr-orbit" aria-hidden="true">
              <span className="mk-art__moon" />
            </span>
            <span className="mk-art__orbit mk-art__orbit--b tkr-orbit" aria-hidden="true" />

            <figure className="mk-arch">
              <Image
                src={LEAD.src}
                alt={LEAD.alt}
                width={760}
                height={760}
                className="mk-arch__img"
                priority
                sizes="(max-width: 900px) 70vw, 380px"
              />
            </figure>

            {/* The rotating seal. The text is drawn around a circular path, so
                it curves properly instead of being faked with per-letter
                rotations that break at any other font size. */}
            <span className="mk-seal" aria-hidden="true">
              <svg viewBox="0 0 120 120" className="mk-seal__type">
                <defs>
                  <path
                    id="mk-seal-path"
                    d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0"
                    fill="none"
                  />
                </defs>
                <text>
                  <textPath href="#mk-seal-path" startOffset="0">
                    · FROM THE MANDI · TO YOUR DOOR
                  </textPath>
                </text>
              </svg>
              <svg viewBox="0 0 24 24" className="mk-seal__leaf">
                <path d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z" fill="currentColor" />
              </svg>
            </span>

            <span className="mk-float mk-float--eta">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              At your door in 22 minutes
            </span>

            <span className="mk-float mk-float--price">
              <span className="mk-float__eyebrow">On the shelf today</span>
              <span className="mk-float__name">Amul Taaza Milk</span>
              <span className="mk-float__value">from ₹28</span>
            </span>

            <span className="mk-float mk-float--pick">
              <span className="mk-float__thumb">
                <Image src="/products/curd.jpg" alt="" width={96} height={96} />
              </span>
              <span>
                <span className="mk-float__eyebrow">Picked at dawn</span>
                <span className="mk-float__name">Nandini Fresh Curd</span>
              </span>
            </span>

            <span className="mk-tile mk-tile--a" aria-hidden="true">
              <Image src="/products/banana.jpg" alt="" width={120} height={120} />
            </span>
            <span className="mk-tile mk-tile--b" aria-hidden="true">
              <Image src="/products/carrot.jpg" alt="" width={120} height={120} />
            </span>

            <span className="mk-leaf mk-leaf--a" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z" fill="currentColor" />
              </svg>
            </span>
            <span className="mk-leaf mk-leaf--b" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z" fill="currentColor" />
              </svg>
            </span>
          </div>

          <ul className="mk-feats mk-feats--right">
            {FEATS.slice(3).map((feat) => (
              <Feat feat={feat} key={feat.label} />
            ))}
          </ul>
        </div>

        {/* ── the closing glass panel ───────────────────────────────────── */}
        <div className="mk-hero__panel">
          <span className="mk-globe" aria-hidden="true" />
          <p className="mk-hero__tag">
            The shop on your street,
            <span> one tap away.</span>
          </p>
          <p className="mk-scroll" aria-hidden="true">
            <span className="mk-scroll__mouse">
              <span className="mk-scroll__dot" />
            </span>
            scroll to explore
          </p>
        </div>
      </div>
    </section>
  );
}
