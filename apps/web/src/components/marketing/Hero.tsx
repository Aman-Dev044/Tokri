import Image from 'next/image';
import Link from 'next/link';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE FRONT DOOR
 * ════════════════════════════════════════════════════════════════════════
 *
 * Modelled closely on the reference the owner chose: a serif headline whose
 * second line turns italic under a hand-drawn gold swash, two pill actions,
 * three trust chips, and — carrying the whole right half — a photograph of
 * the food inside an ARCH, orbited by a rotating seal and two floating
 * cards that quote real numbers.
 *
 * ── Why an arch ─────────────────────────────────────────────────────────
 * A rectangle reads as a screenshot; an arch reads as a window onto
 * something. It is one `border-radius` with a huge top value, which costs
 * nothing and changes the whole temperature of the section.
 *
 * ── It is still a SERVER component ──────────────────────────────────────
 * Every moving part here is CSS: the seal rotates on `spin`, the leaves on
 * `float`, the cards arrive on `rise`, the scroll dot on `scroll-dot`. None
 * of it needs state, so the largest and first-painted section of the site
 * ships no JavaScript — and all of it stops under
 * `prefers-reduced-motion`.
 *
 * ── The numbers are real ────────────────────────────────────────────────
 * "from ₹28" is Amul Taaza at its seeded price and "under 22 minutes" is
 * the figure quoted everywhere else on this page. A hero that invents a
 * price is the first thing a visitor catches you on.
 */

/** Trust chips. Each is a fact this service actually keeps. */
const CHIPS: ReadonlyArray<{ label: string; icon: React.ReactNode }> = [
  {
    label: 'Picked today',
    icon: (
      <path d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z" fill="none" strokeWidth="1.6" />
    ),
  },
  {
    label: 'Shops near you',
    icon: (
      <path
        d="M4 10 12 4l8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"
        fill="none"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
  },
  {
    label: 'Cash or online',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" fill="none" strokeWidth="1.6" />
        <path d="M3 10h18" strokeWidth="1.6" />
      </>
    ),
  },
];

/** The two photographs tucked behind the arch, and the one inside it. */
const LEAD = { src: '/products/mango.jpg', alt: 'Alphonso mangoes on the branch' };

export function Hero() {
  return (
    <section className="mk-hero" id="top">
      {/* Soft cream-to-green wash behind everything, and two drifting leaves.
          Decorative only, so it is hidden from assistive technology. */}
      <div className="mk-hero__wash" aria-hidden="true" />

      <div className="mk-shell mk-hero__grid">
        <div className="mk-hero__copy">
          <p className="mk-hero__eyebrow">
            <span className="mk-hero__rule" aria-hidden="true" />
            मंडी · fresh · local
          </p>

          <h1 className="mk-hero__title">
            Fresh from the mandi,
            <span className="mk-hero__em">
              to your door.
              {/* A drawn swash, not a border: it has the wobble of a pen,
                  which a straight 2px rule cannot imitate. */}
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
            <Link className="mk-pill mk-pill--solid" href="/shop">
              Start shopping
              <svg viewBox="0 0 24 24" aria-hidden="true" className="mk-pill__arrow">
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

          <ul className="mk-chips">
            {CHIPS.map((chip) => (
              <li className="mk-chip" key={chip.label}>
                <span className="mk-chip__badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" stroke="currentColor">
                    {chip.icon}
                  </svg>
                </span>
                {chip.label}
              </li>
            ))}
          </ul>

          <p className="mk-scroll" aria-hidden="true">
            <span className="mk-scroll__mouse">
              <span className="mk-scroll__dot" />
            </span>
            scroll to explore
          </p>
        </div>

        {/* ── the stage ──────────────────────────────────────────────── */}
        <div className="mk-stage">
          <span className="mk-stage__ring" aria-hidden="true" />

          <figure className="mk-arch">
            <Image
              src={LEAD.src}
              alt={LEAD.alt}
              width={760}
              height={900}
              className="mk-arch__img"
              priority
              sizes="(max-width: 900px) 86vw, 460px"
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
              <path
                d="M12 3c0 4-3 5-3 8a3 3 0 0 0 6 0c0-3-3-4-3-8Z"
                fill="currentColor"
              />
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
      </div>
    </section>
  );
}
