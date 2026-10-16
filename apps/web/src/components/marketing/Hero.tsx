import Image from 'next/image';
import Link from 'next/link';

import { CountUp } from '@/components/marketing/CountUp';
import { MagneticLink } from '@/components/marketing/MagneticLink';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE FRONT DOOR
 * ════════════════════════════════════════════════════════════════════════
 *
 * What this replaced: a parallax rig of tinted glyphs behind a headline
 * about the app changing colour. It was about the INTERFACE. Somebody
 * arriving at a grocery service wants to know what is in the shop, how
 * fast it comes and whether it reaches their street — none of which an
 * abstract glyph can answer.
 *
 * So the hero now leads with food. Four real photographs from the
 * catalogue, the same files `/shop` serves, sized and cropped by
 * `next/image`.
 *
 * ── It is a SERVER component now ────────────────────────────────────────
 * The old one was `'use client'` for a hover state that re-tinted the page
 * and a 3D tilt rig. Both are gone, so the largest, first-painted section
 * of the site now ships no JavaScript at all and arrives as HTML. The
 * stat counters below are the one client island, and they are deliberately
 * small.
 *
 * ── Why the photographs are in the markup, not a background ─────────────
 * `background-image` is invisible to `next/image`, so it cannot be resized
 * per breakpoint, cannot be lazily loaded and cannot carry alt text. These
 * are real `<Image>` elements with `priority` on the one that lands above
 * the fold, which is also the Largest Contentful Paint on most screens.
 */

/** Four from the shelf, chosen to read as "groceries" in one glance. */
const PLATE: ReadonlyArray<{ src: string; alt: string; aisle: string }> = [
  { src: '/products/mango.jpg', alt: 'Alphonso mangoes', aisle: 'fruits' },
  { src: '/products/milk.jpg', alt: 'Fresh milk being poured', aisle: 'dairy' },
  { src: '/products/tomato.jpg', alt: 'Ripe tomatoes', aisle: 'vegetables' },
  { src: '/products/bread.jpg', alt: 'Fresh bread', aisle: 'bakery' },
];

const STATS: ReadonlyArray<{ to: number; unit: string; label: string; money?: boolean }> = [
  { to: 22, unit: 'min', label: 'Typical handover' },
  { to: 5, unit: 'km', label: 'Serviceable radius' },
  { to: 9, unit: '', label: 'Aisles, every shop' },
];

export function Hero() {
  return (
    <section className="mk-hero" id="top">
      <div className="mk-shell mk-hero__grid">
        <div className="mk-hero__copy">
          <p className="mk-eyebrow">मंडी · multi-vendor grocery, India</p>

          <h1 className="mk-hero__title">
            Fresh from the mandi,
            <br />
            <span className="mk-hero__accent">to your door.</span>
          </h1>

          <p className="mk-lede">
            Not a warehouse with a catalogue stapled on. It is the kirana, the dairy
            and the bakery already on your street — picked by a real shop near you and
            handed over in about twenty minutes.
          </p>

          <div className="mk-hero__cta">
            <MagneticLink href="/shop">Start shopping</MagneticLink>
            <MagneticLink href="/#how-it-works" variant="quiet">
              See how it works
            </MagneticLink>
          </div>

          <ul className="mk-hero__stats">
            {STATS.map((stat) => (
              <li className="mk-hero__stat" key={stat.label}>
                <span className="mk-hero__stat-value">
                  <CountUp to={stat.to} />
                  {stat.unit !== '' ? (
                    <span className="mk-hero__stat-unit">{stat.unit}</span>
                  ) : null}
                </span>
                <span className="mk-hero__stat-label">{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* The plate: one large photograph with three behind it. Decorative
            as a composition, but each image still carries real alt text —
            a screen reader is told what the food is, not that there is a
            "hero image". */}
        <div className="mk-plate" aria-hidden="false">
          {PLATE.map((shot, i) => (
            <figure
              className={i === 0 ? 'mk-plate__cell mk-plate__cell--lead' : 'mk-plate__cell'}
              key={shot.src}
              data-aisle={shot.aisle}
              style={{ ['--i' as string]: i }}
            >
              <Image
                src={shot.src}
                alt={shot.alt}
                width={i === 0 ? 720 : 360}
                height={i === 0 ? 720 : 360}
                className="mk-plate__img"
                priority={i === 0}
                sizes={
                  i === 0
                    ? '(max-width: 900px) 90vw, 420px'
                    : '(max-width: 900px) 30vw, 200px'
                }
              />
            </figure>
          ))}
        </div>
      </div>

      <p className="mk-hero__note">
        <Link className="mk-link" href="/stores">
          Or browse store by store →
        </Link>
      </p>
    </section>
  );
}
