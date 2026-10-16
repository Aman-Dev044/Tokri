import type { Metadata } from 'next';
import Link from 'next/link';
import { AISLES } from '@mandi/design-system';

import { Hero } from '@/components/marketing/Hero';
import { ProduceTicker } from '@/components/marketing/ProduceTicker';
import { AisleShowcase } from '@/components/marketing/AisleShowcase';
import { FeaturedShelf } from '@/components/marketing/FeaturedShelf';
import { DeliveryCheck } from '@/components/marketing/DeliveryCheck';
import { Faq } from '@/components/marketing/Faq';
import { MagneticLink } from '@/components/marketing/MagneticLink';
import { APP_NAME, APP_TITLE } from '@/config/brand';

export const metadata: Metadata = {
  // `absolute` opts out of the root layout's `%s · <brand>` template. Without
  // it the home page reads "Tokri — fill your basket · Tokri", because the
  // template appends the brand to a title that already carries it.
  title: { absolute: APP_TITLE },
  description:
    'Groceries from the kirana, dairy and bakery already near you. Nine aisles, each with its own colour, and an app that re-tints as you walk through them. Delivery in about 22 minutes across a 5 km radius.',
  alternates: { canonical: '/' },
  openGraph: {
    title: APP_TITLE,
    description:
      'Nine aisles, nine colours, one market. Multi-vendor grocery delivery built for India.',
    url: '/',
    type: 'website',
  },
};

/* SSG + ISR. The landing page must be instant and crawlable (plan section 3.3).
   One hour is long enough to stay cheap and short enough that a copy change
   does not need a deploy. */
export const revalidate = 3600;

const STEPS = [
  {
    n: '01',
    title: 'Pick a shop, not a warehouse',
    body: `${APP_NAME} shows the stores within 5 km that are actually open right now. One vendor per cart, so one order is one pickup and one rider — which is the only way grocery delivery is ever genuinely fast.`,
  },
  {
    n: '02',
    title: 'Walk the aisles',
    body: 'Choose Fruits and the whole app turns tomato. Choose Frozen and it turns frost. You are never three taps deep wondering which category you are in — the interface has already told you.',
  },
  {
    n: '03',
    title: 'The shop packs it while you watch',
    body: 'Accepted, packing, ready. Every state change is stamped by the person who made it, with a timestamp, and it reaches you the moment it happens rather than on the next refresh.',
  },
  {
    n: '04',
    title: 'A four-digit code closes it',
    body: 'Your rider asks for a four-digit code at the door. It works for cash and for prepaid, it proves the handover, and it is the same ritual every single time.',
  },
];

const WHY = [
  {
    head: 'One vendor per order',
    body: 'Splitting a basket across three shops means three pickups, three riders and three things to go wrong. Switching shops parks your old basket instead of destroying it — it is still there when you come back.',
  },
  {
    head: 'The price you saw is the price you pay',
    body: 'Every line is stored in integer paise and re-checked at checkout against live stock. If the shop is out of one ₹40 item, they part-fulfil and that line refunds itself. Your ₹900 order does not die over a missing lemon.',
  },
  {
    head: 'Cash is a first-class citizen',
    body: 'Cash on delivery, up to ₹2,000, toggled per shop. Not a grudging fallback buried under a payment sheet — the default half of Indian grocery.',
  },
  {
    head: 'Free until the shop says yes',
    body: 'Cancel with no charge and no argument right up to the moment a vendor accepts. After that it needs their nod, and every step of that conversation is on the record.',
  },
] as const;

const WHY_TONES = ['mint', 'coral', 'violet', 'gold'] as const;

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProduceTicker />

      {/* ── WHAT IS ACTUALLY ON THE SHELF ──────────────────────────────── */}
      <FeaturedShelf />

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <section className="mk-sec" id="how-it-works">
        <div className="mk-shell">
          <header className="mk-sec__head mk-sec__head--wide">
            <p className="mk-eyebrow">How it works</p>
            <h2 className="mk-title">
              Four steps. No countdown
              <br />
              screaming at you.
            </h2>
            <p className="mk-lede">
              Everyone else puts a ticking clock on the screen and calls it urgency. We
              would rather tell you exactly what is happening and let you get on with
              your evening.
            </p>
          </header>

          <ul className="mk-grid">
            {STEPS.map((step, i) => (
              <li className="mk-cell mk-cell--3" key={step.n}>
                <div className="mk-step tkr-card" style={{ ['--i' as string]: i }}>
                  <span className="mk-step__n">{step.n}</span>
                  <h3 className="mk-step__title">{step.title}</h3>
                  <p className="mk-step__body">{step.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── CAN THEY EVEN USE IT? ──────────────────────────────────────── */}
      <DeliveryCheck />

      {/* ── PILLAR 1: THE CHROMATIC AISLES ─────────────────────────────── */}
      <AisleShowcase />

      {/* ── WHY THIS APP ───────────────────────────────────────────────── */}
      <section className="mk-sec" id="why">
        <div className="mk-shell">
          <header className="mk-sec__head mk-sec__head--wide">
            <p className="mk-eyebrow">Why {APP_NAME}</p>
            <h2 className="mk-title">
              Built like a market.
              <br />
              <em>Not like a warehouse.</em>
            </h2>
            <p className="mk-lede">
              Open the four biggest grocery apps side by side and they are the same app:
              three-across grids of cramped tiles, one brand colour forever, a timer
              shouting at you. Efficient, forgettable, interchangeable. We went the other
              way on purpose — and it is designed for whichever theme you already use,
              light or dark.
            </p>
          </header>

          <ul className="mk-grid">
            {WHY.map((item, i) => (
              <li
                className={`mk-cell mk-cell--3 mk-cell--tone-${WHY_TONES[i % WHY_TONES.length]}`}
                key={item.head}
              >
                <div className="mk-claim tkr-card" style={{ ['--i' as string]: i }}>
                  <span className="mk-claim__mark mono">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mk-claim__head">{item.head}</h3>
                  <p className="mk-claim__body">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── VENDOR CTA ─────────────────────────────────────────────────── */}
      <section className="mk-sec" id="vendors">
        <div className="mk-shell">
          <ul className="mk-grid">
            <li className="mk-cell mk-cell--8">
              <div className="mk-band tkr-card tkr-card--raised" style={{ ['--i' as string]: 0 }}>
                <p className="mk-eyebrow">For vendors</p>
                <h2 className="mk-title">
                  Your shop. Your prices.
                  <br />
                  Your customers.
                </h2>
                <p className="mk-lede">
                  {APP_NAME} is a marketplace, not a middleman that quietly becomes your
                  competitor. You set your catalogue, your stock and your opening hours.
                  The commission is a flat percentage you agree once — and it is copied
                  onto each order at the moment it is placed, so changing the rate later
                  never rewrites what you have already earned.
                </p>
                <ul className="mk-facts">
                  <li>
                    <b>Weekly</b> settlement, every Monday
                  </li>
                  <li>
                    <b>Live</b> order board with sound alerts
                  </li>
                  <li>
                    <b>Per-shop</b> cash-on-delivery toggle and cap
                  </li>
                </ul>
                <div className="mk-band__cta">
                  <MagneticLink href="/signup" variant="solid">
                    List your shop
                  </MagneticLink>
                </div>
              </div>
            </li>

            <li className="mk-cell mk-cell--4 mk-cell--tone-gold">
              <div className="mk-ledger-card tkr-card" style={{ ['--i' as string]: 1 }}>
                <p className="mk-eyebrow">Settlement · week 38</p>
                <dl className="mk-ledger">
                  <div className="mk-ledger__row">
                    <dt>Gross sales</dt>
                    <dd>₹1,84,250</dd>
                  </div>
                  <div className="mk-ledger__row">
                    <dt>Commission (8%)</dt>
                    <dd className="mk-ledger__neg">−₹14,740</dd>
                  </div>
                  <div className="mk-ledger__row">
                    <dt>Refunds</dt>
                    <dd className="mk-ledger__neg">−₹2,110</dd>
                  </div>
                  <div className="mk-ledger__total">
                    <span>Net payable</span>
                    <span className="mk-ledger__big">₹1,67,400</span>
                  </div>
                </dl>
                <p className="mk-note">
                  Illustrative figures. Every amount in {APP_NAME} is stored as integer
                  paise — floating-point rupees produce reports that are off by a few
                  paise and take a week to debug.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* ── RIDER CTA ──────────────────────────────────────────────────── */}
      <section className="mk-sec" id="riders">
        <div className="mk-shell">
          <ul className="mk-grid">
            <li className="mk-cell mk-cell--4 mk-cell--tone-mint">
              <div className="mk-offer-card tkr-card" style={{ ['--i' as string]: 0 }}>
                <p className="mk-offer__head">
                  <span>Offer</span>
                  <span className="mono">expires in 00:24</span>
                </p>

                <div className="mk-offer__leg">
                  <span className="mk-offer__pin" aria-hidden="true">
                    <span />
                  </span>
                  <span className="mk-offer__where">Sharma Kirana, 2nd Block</span>
                </div>
                <div className="mk-offer__leg mk-offer__leg--drop">
                  <span className="mk-offer__pin" aria-hidden="true">
                    <span />
                  </span>
                  <span className="mk-offer__where">Drop · HSR Layout, Sector 6</span>
                </div>

                <dl className="mk-offer__meta">
                  <div>
                    <dt>Distance</dt>
                    <dd>3.4 km</dd>
                  </div>
                  <div>
                    <dt>Payout</dt>
                    <dd>₹72</dd>
                  </div>
                  <div>
                    <dt>Items</dt>
                    <dd>14</dd>
                  </div>
                </dl>

                <p className="mk-otp">
                  <span className="mk-eyebrow">Handover code</span>
                  <span aria-hidden="true">
                    {[4, 8, 1, 3].map((d, i) => (
                      <b key={i} style={{ ['--d' as string]: i }}>
                        {d}
                      </b>
                    ))}
                  </span>
                </p>
              </div>
            </li>

            <li className="mk-cell mk-cell--8">
              <div className="mk-band tkr-card tkr-card--raised" style={{ ['--i' as string]: 1 }}>
                <p className="mk-eyebrow">For riders</p>
                <h2 className="mk-title">
                  One job on screen.
                  <br />
                  Buttons you can hit
                  <br />
                  wearing gloves.
                </h2>
                <p className="mk-lede">
                  The rider panel is a different piece of design from the shopping app, on
                  purpose. One action per screen, 64-pixel targets, maximum contrast, a big
                  mono ETA you can read at arm&apos;s length in the rain. No decoration,
                  nothing to hunt for.
                </p>
                <ul className="mk-facts">
                  <li>
                    <b>Offers</b> you accept or decline — never assigned silently
                  </li>
                  <li>
                    <b>Payout</b> shown before you accept, not after
                  </li>
                  <li>
                    <b>Works</b> one-handed, on a bad connection
                  </li>
                </ul>
                <div className="mk-band__cta">
                  <MagneticLink href="/signup" variant="quiet">
                    Ride with {APP_NAME}
                  </MagneticLink>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <Faq />

      {/* ── CLOSING ────────────────────────────────────────────────────── */}
      <section className="mk-sec mk-sec--tight">
        <div className="mk-shell">
          <ul className="mk-grid">
            <li className="mk-cell mk-cell--12">
              <div className="mk-closer tkr-card tkr-card--raised" style={{ ['--i' as string]: 0 }}>
                <p className="mk-eyebrow">Ready when you are</p>
                {/* The hue underlines each word rather than colouring it. Several of
                    the eight aisle hues cannot clear 4.5:1 as text on either ground
                    (saffron is 2.3:1), and a decorative rule carries the identity
                    without putting an unreadable word on the page. */}
                <h2 className="mk-closer__title">
                  {AISLES.map((a) => (
                    <span
                      className="mk-closer__word"
                      key={a.key}
                      style={{ ['--sw' as string]: `var(--aisle-${a.key})` }}
                    >
                      {a.name}
                    </span>
                  ))}
                </h2>
                <p className="mk-lede">
                  Nine aisles waiting. Create an account and the market opens in the
                  colour of whatever you reach for first.
                </p>
                <div className="mk-closer__cta">
                  <MagneticLink href="/signup" variant="solid">
                    Create an account
                  </MagneticLink>
                  <Link href="/login" className="mk-btn mk-btn--ghost mk-btn--lg">
                    I already have one
                  </Link>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
