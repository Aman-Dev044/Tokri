import type { Metadata } from 'next';
import Link from 'next/link';
import { AISLES } from '@mandi/design-system';

import { Hero } from '@/components/marketing/Hero';
import { ProduceTicker } from '@/components/marketing/ProduceTicker';
import { AisleShowcase } from '@/components/marketing/AisleShowcase';
import { CircadianStrip } from '@/components/marketing/CircadianStrip';

export const metadata: Metadata = {
  title: 'Mandi — the market, delivered',
  description:
    'Groceries from the kirana, dairy and bakery already near you. Eight aisles, each with its own colour, and an app that re-tints as you walk through them. Delivery in about 22 minutes across a 5 km radius.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Mandi — the market, delivered',
    description:
      'Eight aisles, eight colours, one market. Multi-vendor grocery delivery built for India.',
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
    body: 'Mandi shows the stores within 5 km that are actually open right now. One vendor per cart, so one order is one pickup and one rider — which is the only way grocery delivery is ever genuinely fast.',
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
];

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProduceTicker />

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <section className="steps bleed" id="how-it-works">
        <div className="shell">
          <header className="section-head section-head--wide">
            <p className="eyebrow">How it works</p>
            <h2 className="section-title">
              Four steps. No countdown
              <br />
              screaming at you.
            </h2>
            <p className="lede">
              Everyone else puts a ticking clock on the screen and calls it urgency. We
              would rather tell you exactly what is happening and let you get on with
              your evening.
            </p>
          </header>

          <ol className="steps__list">
            {STEPS.map((step, i) => (
              <li className="step rise" key={step.n} style={{ ['--i' as string]: String(i) }}>
                <span className="step__n mono" aria-hidden="true">
                  {step.n}
                </span>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__body">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── PILLAR 1: THE CHROMATIC AISLES ─────────────────────────────── */}
      <AisleShowcase />

      {/* ── WHY MANDI + PILLAR 2 ───────────────────────────────────────── */}
      <section className="why bleed" id="why">
        <div className="shell why__grid">
          <div className="why__lead">
            <p className="eyebrow">Why Mandi</p>
            <h2 className="section-title">
              Built like a market.
              <br />
              <span className="section-title-accent">Not like a warehouse.</span>
            </h2>
            <p className="lede">
              Open the four biggest grocery apps side by side and they are the same app:
              three-across grids of cramped tiles, one brand colour forever, a timer
              shouting at you. Efficient, forgettable, interchangeable. We went the other
              way on purpose.
            </p>

            <div className="why__circadian">
              <h3 className="why__sub">The ground follows the clock</h3>
              <p className="why__sub-body">
                The store at 7am does not look like the store at 11pm. Mandi shifts the
                paper underneath everything four times a day — inside whichever theme you
                are already using. These four plates are live samples, not pictures.
              </p>
              <CircadianStrip />
            </div>
          </div>

          <ul className="why__list">
            {WHY.map((item, i) => (
              <li className="why__item rise" key={item.head} style={{ ['--i' as string]: String(i) }}>
                <h3 className="why__head">{item.head}</h3>
                <p className="why__body">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── VENDOR CTA ─────────────────────────────────────────────────── */}
      <section className="band bleed" id="vendors" data-tone="ink">
        <div className="shell band__grid">
          <div className="band__copy">
            <p className="eyebrow">For vendors</p>
            <h2 className="band__title">
              Your shop. Your prices.
              <br />
              Your customers.
            </h2>
            <p className="band__body">
              Mandi is a marketplace, not a middleman that quietly becomes your
              competitor. You set your catalogue, your stock and your opening hours. The
              commission is a flat percentage you agree once — and it is copied onto each
              order at the moment it is placed, so changing the rate later never rewrites
              what you have already earned.
            </p>
            <ul className="band__facts">
              <li>
                <span className="mono">Weekly</span> settlement, every Monday
              </li>
              <li>
                <span className="mono">Live</span> order board with sound alerts
              </li>
              <li>
                <span className="mono">Per-shop</span> cash-on-delivery toggle and cap
              </li>
            </ul>
            <Link href="/signup" className="mnd-btn mnd-btn--solid mnd-btn--lg">
              List your shop
            </Link>
          </div>

          <aside className="ledger" aria-label="Example settlement">
            <p className="ledger__head mono">Settlement · week 38</p>
            <dl className="ledger__rows">
              <div>
                <dt>Gross sales</dt>
                <dd className="price">₹1,84,250</dd>
              </div>
              <div>
                <dt>Commission (8%)</dt>
                <dd className="price ledger__neg">−₹14,740</dd>
              </div>
              <div>
                <dt>Refunds</dt>
                <dd className="price ledger__neg">−₹2,110</dd>
              </div>
            </dl>
            <hr className="mnd-rule" />
            <div className="ledger__total">
              <span>Net payable</span>
              <span className="price ledger__big">₹1,67,400</span>
            </div>
            <p className="ledger__note">
              Illustrative figures. Every amount in Mandi is stored as integer paise —
              floating-point rupees produce reports that are off by a few paise and take
              a week to debug.
            </p>
          </aside>
        </div>
      </section>

      {/* ── RIDER CTA ──────────────────────────────────────────────────── */}
      <section className="band bleed band--mirror" id="riders">
        <div className="shell band__grid">
          <aside className="rider-card" aria-label="Example delivery job">
            <p className="rider-card__head mono">Offer · expires in 00:24</p>
            <p className="rider-card__pickup">Sharma Kirana, 2nd Block</p>
            <p className="rider-card__drop">Drop · HSR Layout, Sector 6</p>
            <dl className="rider-card__meta">
              <div>
                <dt>Distance</dt>
                <dd className="mono">3.4 km</dd>
              </div>
              <div>
                <dt>Payout</dt>
                <dd className="price">₹72</dd>
              </div>
              <div>
                <dt>Items</dt>
                <dd className="mono">14</dd>
              </div>
            </dl>
            <p className="rider-card__otp">
              <span className="eyebrow">Handover code</span>
              <span className="rider-card__otp-digits mono">4 · 8 · 1 · 3</span>
            </p>
          </aside>

          <div className="band__copy">
            <p className="eyebrow">For riders</p>
            <h2 className="band__title">
              One job on screen.
              <br />
              Buttons you can hit
              <br />
              wearing gloves.
            </h2>
            <p className="band__body">
              The rider panel is a different piece of design from the shopping app, on
              purpose. One action per screen, 64-pixel targets, maximum contrast, a big
              mono ETA you can read at arm&apos;s length in the rain. No decoration,
              nothing to hunt for.
            </p>
            <ul className="band__facts">
              <li>
                <span className="mono">Offers</span> you accept or decline — never
                assigned silently
              </li>
              <li>
                <span className="mono">Payout</span> shown before you accept, not after
              </li>
              <li>
                <span className="mono">Works</span> one-handed, on a bad connection
              </li>
            </ul>
            <Link href="/signup" className="mnd-btn mnd-btn--outline mnd-btn--lg">
              Ride with Mandi
            </Link>
          </div>
        </div>
      </section>

      {/* ── CLOSING ────────────────────────────────────────────────────── */}
      <section className="closer bleed">
        <div className="shell">
          <p className="closer__kicker eyebrow">Ready when you are</p>
          {/* The hue underlines each word rather than colouring it. Several of
              the eight aisle hues cannot clear 4.5:1 as text on paper (butter
              is 2.3:1), and a decorative rule carries the identity without
              putting an unreadable word on the page. */}
          <h2 className="closer__title">
            {AISLES.map((a, i) => (
              <span
                className="closer__word"
                key={a.key}
                style={{ ['--w' as string]: a.swatch }}
              >
                {a.name}
                {i < AISLES.length - 1 ? (
                  <span className="closer__sep" aria-hidden="true">
                    {' '}
                  </span>
                ) : null}
              </span>
            ))}
          </h2>
          <p className="lede closer__lede">
            Eight aisles waiting. Create an account and the market opens in the colour of
            whatever you reach for first.
          </p>
          <div className="closer__cta">
            <Link href="/signup" className="mnd-btn mnd-btn--solid mnd-btn--lg">
              Create an account
            </Link>
            <Link href="/login" className="mnd-btn mnd-btn--ghost mnd-btn--lg">
              I already have one
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
