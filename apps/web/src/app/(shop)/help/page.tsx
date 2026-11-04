import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatPaise } from '@mandi/design-system';

import { APP_NAME } from '@/config/brand';
import { ContactCard } from '@/components/help/ContactCard';
import { InfoPage, InfoSection, type TocEntry } from '@/components/help/InfoPage';
import { fetchPublicSettings, type PublicSettings } from '@/lib/public-settings';

/**
 * /help — the FAQ and the support contact.
 *
 * ── Every answer is checked against the code ────────────────────────────────
 * Each one names the behaviour that makes it true, so the next person to
 * change that behaviour can find the sentence that now lies:
 *
 *   delivery fee / free threshold  `GET /settings/public`, and the rule in
 *                                  api `shop/pricing/pricing.ts`
 *                                  (free when subtotal − discount ≥ threshold)
 *   GST                            `GST_PCT = 5` in the same file, charged on
 *                                  subtotal − discount
 *   radius                         settings `serviceRadiusKm` (default search)
 *                                  + each store's own radius, 1–25 km, checked
 *                                  at checkout (`OUT_OF_SERVICE_AREA`)
 *   COD                            `CheckoutService.codAvailability` — store
 *                                  toggle + store cap; the store DTO caps it at
 *                                  ₹2,000
 *   online payment                 `payments.isConfigured()`; unpaid ONLINE
 *                                  orders released after 15 minutes
 *   cancel                         `ShopOrdersService.cancel` — free only in
 *                                  PLACED, otherwise CANCELLATION_NEEDS_APPROVAL
 *   delivery code                  `PlacedOrder.deliveryOtp`, returned once;
 *                                  only a hash is stored
 *   one store per basket           `BasketProvider` + `POST /cart/park`; parked
 *                                  carts carry a 7-day TTL
 *   part-fulfilment                vendor `updateFulfilment`, ACCEPTED/PACKING
 *                                  only; COD pays the lower total
 *   sell / ride                    `/signup` tabs → `POST /auth/apply/*`,
 *                                  pending until an admin approves
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Help & FAQ',
  description: `How ${APP_NAME} works: delivery fees, cash on delivery, cancelling, the 4-digit delivery code, and how to reach support.`,
  alternates: { canonical: '/help' },
};

const TOC: readonly TocEntry[] = [
  { id: 'ordering', label: 'Ordering and delivery' },
  { id: 'paying', label: 'Paying' },
  { id: 'code', label: 'The delivery code' },
  { id: 'cancelling', label: 'Cancelling and refunds' },
  { id: 'account', label: 'Your account' },
  { id: 'partners', label: 'Selling and delivering' },
  { id: 'contact', label: 'Contact support' },
];

interface Qa {
  q: string;
  a: ReactNode;
}

function Faq({ items }: { items: readonly Qa[] }) {
  return (
    <ul className="hlp-faq">
      {items.map((item) => (
        <li key={item.q}>
          <details>
            <summary>{item.q}</summary>
            <div className="hlp-faq__answer">{item.a}</div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function deliveryFeeAnswer(s: PublicSettings | null): ReactNode {
  if (s === null) {
    return (
      <p>
        A flat delivery fee applies to smaller orders and delivery is free above a minimum
        order value. Both are shown on your basket and at checkout before you pay.
      </p>
    );
  }
  if (s.deliveryFeePaise === 0) {
    return <p>Delivery is free on every order right now.</p>;
  }
  return (
    <>
      <p>
        Delivery costs <strong>{formatPaise(s.deliveryFeePaise)}</strong> per order, and is{' '}
        <strong>free when your items come to {formatPaise(s.freeDeliveryThresholdPaise)} or
        more</strong>.
      </p>
      <p>
        The free-delivery check uses your item total <em>after</em> any coupon discount and
        before taxes, so a coupon can&rsquo;t tip a smaller basket into free delivery. The
        fee always appears as its own line at checkout before you pay.
      </p>
    </>
  );
}

function radiusAnswer(s: PublicSettings | null): ReactNode {
  return (
    <>
      <p>
        {s === null ? (
          <>The store list shows stores near the location you give us.</>
        ) : (
          <>
            By default the store list shows stores within{' '}
            <strong>{s.serviceRadiusKm} km</strong> of the location you give us.
          </>
        )}{' '}
        Each store also sets its own delivery radius, and checkout checks your saved address
        against it. If the address is too far, checkout tells you the store&rsquo;s radius and
        how far away you are, and won&rsquo;t let the order through.
      </p>
      <p>
        No location permission? You can enter your 6-digit PIN code instead. If we
        don&rsquo;t deliver to that PIN yet, we&rsquo;ll say so.
      </p>
    </>
  );
}

export default async function HelpPage() {
  const s = await fetchPublicSettings();
  const name = s?.platformName ?? APP_NAME;

  const ordering: Qa[] = [
    {
      q: `Who actually sells the groceries?`,
      a: (
        <p>
          Local stores do. {name} is a marketplace: each store lists its own products,
          sets its own prices and packs your order, and a delivery partner brings it to your
          door. The store you order from is the seller.
        </p>
      ),
    },
    { q: 'How much is delivery?', a: deliveryFeeAnswer(s) },
    {
      q: 'Is GST included in the prices?',
      a: (
        <p>
          Taxes are shown as a separate line at checkout. GST is currently worked out at 5% on
          your items after any coupon discount. The total you see on the checkout screen is
          the total you pay.
        </p>
      ),
    },
    { q: 'How far do you deliver?', a: radiusAnswer(s) },
    {
      q: 'Can I order from two stores at once?',
      a: (
        <>
          <p>
            Not in one order. A basket holds one store&rsquo;s products, so each order is one
            pickup and one rider. That&rsquo;s what keeps delivery quick.
          </p>
          <p>
            If you add something from a different store, we ask first. If you go ahead, your
            first basket is <strong>parked, not deleted</strong>, and you can bring it back
            later. A parked basket is kept for up to 7 days.
          </p>
        </>
      ),
    },
    {
      q: 'How long will my order take?',
      a: (
        <p>
          After you order, the tracking page shows the time your order is expected by and
          updates as each step happens: accepted, packing, ready, picked up, on the way. Once
          the rider sets off you can follow them on the map.
        </p>
      ),
    },
    {
      q: 'What if the price or stock changes while I shop?',
      a: (
        <p>
          Checkout checks every item again before you pay. If something sold out, has fewer
          left than you wanted, or changed price, you see it on the checkout screen first. You
          are never charged a price you weren&rsquo;t shown. You also can&rsquo;t order from a
          store that is closed right now.
        </p>
      ),
    },
    {
      q: 'Do I need an account to look around?',
      a: (
        <p>
          No. Stores, aisles, products and prices are all open without signing in. You only
          need an account to check out and to see your orders.
        </p>
      ),
    },
  ];

  const paying: Qa[] = [
    {
      q: 'Can I pay cash on delivery?',
      a: (
        <>
          <p>
            Yes, at stores that accept it. Each store decides whether to offer cash on
            delivery and sets a cash limit for each order. That limit is never more than{' '}
            <strong>₹2,000</strong>, because it is the cash one rider carries.
          </p>
          <p>
            If the store has cash on delivery switched off, or your total is over its limit,
            checkout tells you why and asks you to pay another way.
          </p>
        </>
      ),
    },
    {
      q: 'Can I pay online?',
      a: (
        <>
          <p>
            Online payment goes through our payment partner, Razorpay, when it is switched on
            for {name}. If it isn&rsquo;t available yet, checkout says so plainly and offers
            cash on delivery instead.
          </p>
          <p>
            Please finish an online payment within <strong>15 minutes</strong> of placing the
            order. After that an unpaid order is cancelled automatically and its items go back
            on the shelf. We check with the payment provider before cancelling, so a payment
            that went through but was slow to confirm isn&rsquo;t lost.
          </p>
        </>
      ),
    },
    {
      q: 'Can I use a coupon?',
      a: (
        <p>
          Yes, one coupon per order, entered at checkout. A coupon can have a minimum order
          value, a maximum discount, an expiry date and a limit on how many times each
          customer can use it. Checkout tells you if a code doesn&rsquo;t apply, and why.
        </p>
      ),
    },
  ];

  const code: Qa[] = [
    {
      q: 'What is the 4-digit delivery code?',
      a: (
        <>
          <p>
            Every order gets a 4-digit code. It appears <strong>once</strong>, on the
            confirmation screen right after you place the order.{' '}
            <strong>Write it down or take a screenshot.</strong>
          </p>
          <p>
            When the rider reaches your door, tell them the code. The rider cannot mark the
            order delivered without it, which proves the bag reached you. This works the same
            way for cash and prepaid orders.
          </p>
        </>
      ),
    },
    {
      q: 'I closed the screen. Can you show me the code again?',
      a: (
        <p>
          Unfortunately not. We store only a scrambled (hashed) copy, so nobody can read it
          back, not even our own staff. That is what stops someone else from using it. If you
          have lost it, contact support with your order number before the rider arrives.
        </p>
      ),
    },
  ];

  const cancelling: Qa[] = [
    {
      q: 'Can I cancel my order?',
      a: (
        <>
          <p>
            <strong>Yes, for free, while the order is still &ldquo;Placed&rdquo;</strong>,
            meaning the store hasn&rsquo;t accepted it yet. Open <strong>Orders</strong> (or the
            order&rsquo;s tracking page) and tap <strong>Cancel order</strong>. It only appears
            while a free cancellation is still possible.
          </p>
          <p>
            Once the store has accepted it, they have started picking your items, so a free
            cancellation is no longer possible. Contact support and we&rsquo;ll ask the store
            to approve the cancellation.
          </p>
        </>
      ),
    },
    {
      q: 'What if an item is out of stock after I order?',
      a: (
        <>
          <p>
            While packing, the store can remove items it doesn&rsquo;t have, instead of
            cancelling your whole order. This can only happen before the bag is packed, and
            your order is re-priced straight away.
          </p>
          <ul>
            <li>
              <strong>Cash on delivery:</strong> you simply pay the new, lower total.
            </li>
            <li>
              <strong>Paid online:</strong> the difference is recorded as a refund on your
              payment.
            </li>
          </ul>
        </>
      ),
    },
    {
      q: 'What if the store can’t take my order?',
      a: (
        <p>
          The store can reject an order, for example if it is about to close. Your order
          then shows as rejected with the store&rsquo;s reason. Nothing is collected on a cash
          order.
        </p>
      ),
    },
    {
      q: 'How do refunds work for prepaid orders?',
      a: (
        <p>
          Refunds go back to the payment method you used, through our payment partner. Our
          support team issues them. If a cancelled or rejected prepaid order hasn&rsquo;t
          been refunded, write to us with the order number and we&rsquo;ll sort it out.
        </p>
      ),
    },
  ];

  const account: Qa[] = [
    {
      q: 'How do I create an account and sign in?',
      a: (
        <p>
          Go to <Link href="/signup">Sign up</Link> and verify your mobile number with a
          one-time code, then choose a password. After that, sign in with your email or mobile
          number and your password. Forgot it? Use{' '}
          <Link href="/forgot-password">Forgot password</Link>.
        </p>
      ),
    },
    {
      q: 'How do I save a delivery address?',
      a: (
        <p>
          At checkout, or under <Link href="/addresses">Addresses</Link>. Drop a pin on the
          map, or enter your PIN code if the map isn&rsquo;t available. We need the
          location to check that the store delivers to you and to guide the rider.
        </p>
      ),
    },
    {
      q: 'How do I delete my account or my data?',
      a: (
        <p>
          Email support from the address on your account and ask. Our{' '}
          <Link href="/privacy">privacy policy</Link> explains what we keep, why, and your
          rights.
        </p>
      ),
    },
  ];

  const partners: Qa[] = [
    {
      q: `How do I sell on ${name}?`,
      a: (
        <p>
          Open <Link href="/signup">Sign up</Link> and choose <strong>Sell</strong>. Tell us
          about yourself and your store, including its address and a pin on the map. An
          admin reviews every store application by hand. You can&rsquo;t sign in until it
          is approved, and we contact you on the phone number and email you gave once
          there&rsquo;s a decision.
        </p>
      ),
    },
    {
      q: `How do I deliver for ${name}?`,
      a: (
        <p>
          Open <Link href="/signup">Sign up</Link> and choose <strong>Deliver</strong>. Give us
          your name, mobile number and vehicle type. Rider applications are also approved
          by an admin before you can sign in. You may be asked for identity and vehicle
          documents.
        </p>
      ),
    },
  ];

  return (
    <InfoPage
      current="help"
      eyebrow="Help"
      title="Help & FAQ"
      lede={`How ${name} works: fees, payment, the delivery code, cancelling, and how to reach a person.`}
      toc={TOC}
    >
      <InfoSection id="ordering" title="Ordering and delivery">
        <Faq items={ordering} />
      </InfoSection>
      <InfoSection id="paying" title="Paying">
        <Faq items={paying} />
      </InfoSection>
      <InfoSection id="code" title="The delivery code">
        <Faq items={code} />
      </InfoSection>
      <InfoSection id="cancelling" title="Cancelling and refunds">
        <Faq items={cancelling} />
      </InfoSection>
      <InfoSection id="account" title="Your account">
        <Faq items={account} />
      </InfoSection>
      <InfoSection id="partners" title="Selling and delivering">
        <Faq items={partners} />
      </InfoSection>
      <InfoSection id="contact" title="Contact support">
        <p>
          Can&rsquo;t find the answer? Get in touch, and include your order number if
          it&rsquo;s about an order.
        </p>
        <ContactCard settings={s} />
      </InfoSection>
    </InfoPage>
  );
}
