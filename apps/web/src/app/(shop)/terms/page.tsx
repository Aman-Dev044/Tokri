import type { Metadata } from 'next';
import Link from 'next/link';
import { formatPaise } from '@mandi/design-system';

import { APP_NAME } from '@/config/brand';
import { ContactCard } from '@/components/help/ContactCard';
import {
  InfoPage,
  InfoSection,
  LEGAL_LAST_UPDATED,
  Placeholder,
  type TocEntry,
} from '@/components/help/InfoPage';
import { fetchPublicSettings } from '@/lib/public-settings';

/**
 * /terms — a TEMPLATE set of terms for an Indian grocery marketplace.
 *
 * The commercial rules in here (price re-check at checkout, the free-delivery
 * rule, GST line, COD toggle and ₹2,000 ceiling, the 15-minute online-payment
 * window, free cancellation only in PLACED, part-fulfilment, the delivery
 * code) describe what the API actually enforces — see the source map at the
 * top of `app/(shop)/help/page.tsx`. Legal-entity details are placeholders.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Terms of service',
  description: `The terms for buying through ${APP_NAME}: the marketplace model, prices and GST, payment, delivery, cancellations and refunds.`,
  alternates: { canonical: '/terms' },
};

const TOC: readonly TocEntry[] = [
  { id: 'about', label: 'About these terms' },
  { id: 'marketplace', label: 'How the marketplace works' },
  { id: 'account', label: 'Your account' },
  { id: 'prices', label: 'Prices, GST and fees' },
  { id: 'orders', label: 'Orders' },
  { id: 'payment', label: 'Payment' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'cancel', label: 'Cancellations and refunds' },
  { id: 'conduct', label: 'Riders and conduct' },
  { id: 'partners', label: 'Stores and delivery partners' },
  { id: 'use', label: 'Acceptable use' },
  { id: 'liability', label: 'Liability' },
  { id: 'disputes', label: 'Complaints and disputes' },
  { id: 'changes', label: 'Changes' },
];

export default async function TermsPage() {
  const s = await fetchPublicSettings();
  const name = s?.platformName ?? APP_NAME;

  return (
    <InfoPage
      current="terms"
      eyebrow="Policies"
      title="Terms of service"
      lede={`The rules for using ${name} to buy from local stores.`}
      updated={LEGAL_LAST_UPDATED}
      notice={
        <>
          <strong>Template — review with your legal advisor before publishing.</strong> This
          is a starting draft. The highlighted blanks must be completed by the legal entity
          that operates {name}.
        </>
      }
      toc={TOC}
    >
      <InfoSection id="about" title="About these terms">
        <p>
          These terms apply when you use the {name} website or app. {name} is operated by{' '}
          <Placeholder>Legal entity name</Placeholder>, with its registered office at{' '}
          <Placeholder>Registered office address</Placeholder> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By creating an account or placing an order, you agree to these
          terms and to our <Link href="/privacy">privacy policy</Link>.
        </p>
      </InfoSection>

      <InfoSection id="marketplace" title="How the marketplace works">
        <p>
          {name} is an online marketplace. We provide the technology that lets independent
          local stores list their products and lets you order from them. We do not own the
          products listed.
        </p>
        <ul>
          <li>
            <strong>The store is the seller.</strong> When you place an order, your contract of
            sale is with the store you ordered from. The store is responsible for the
            products, their quality, labelling, expiry dates, and any licences the law
            requires (for example, an FSSAI licence for food).
          </li>
          <li>
            Product descriptions, photos and prices are provided by the stores. We work to
            keep them accurate but do not guarantee them.
          </li>
          <li>
            Each order comes from one store. Your basket holds one store&rsquo;s products at a
            time.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="account" title="Your account">
        <ul>
          <li>You must be 18 or older, or use {name} with a parent&rsquo;s or guardian&rsquo;s consent.</li>
          <li>
            Give accurate details, keep your password private, and tell us straight away if
            you think someone else has used your account.
          </li>
          <li>You are responsible for orders placed from your account.</li>
          <li>
            We may suspend or close an account that breaks these terms or is used for fraud.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="prices" title="Prices, GST and fees">
        <ul>
          <li>
            Stores set their own prices, in Indian rupees. Prices can change until you place
            your order. Before you pay, checkout checks every price and stock level again
            and shows you any change. The order is placed at the prices on the checkout
            screen.
          </li>
          <li>
            Taxes are shown as a separate line at checkout. GST is charged on the value of
            your items after any discount, at the applicable rate.
          </li>
          <li>
            {s === null ? (
              <>
                A delivery fee applies to orders below a minimum value. Both are shown before
                you pay.
              </>
            ) : s.deliveryFeePaise === 0 ? (
              <>Delivery is currently free.</>
            ) : (
              <>
                A delivery fee of {formatPaise(s.deliveryFeePaise)} applies, unless your items
                total {formatPaise(s.freeDeliveryThresholdPaise)} or more after any discount.
                We may change these amounts, but the fee on the checkout screen is the fee you
                pay.
              </>
            )}
          </li>
          <li>
            One coupon can be used per order, subject to its own conditions (minimum order
            value, maximum discount, validity and usage limits).
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="orders" title="Orders">
        <ul>
          <li>
            Placing an order is an offer to buy. The contract is formed when the store accepts
            it. A store may reject an order, for example if it cannot fulfil it, and will
            give a reason.
          </li>
          <li>
            If an item turns out to be unavailable, the store may remove it before your order
            is packed instead of cancelling the whole order. The order is re-priced, and you
            pay (or are refunded) accordingly.
          </li>
          <li>Orders can only be placed while the store is open.</li>
        </ul>
      </InfoSection>

      <InfoSection id="payment" title="Payment">
        <ul>
          <li>
            <strong>Cash on delivery</strong> is available only at stores that offer it, and
            only up to the cash limit the store sets, which is never more than ₹2,000 per
            order. Please pay the rider the exact total shown in the app.
          </li>
          <li>
            <strong>Online payment</strong>, when available, is processed by our payment
            partner (Razorpay) under its own terms. An online order that is not paid within 15
            minutes is cancelled automatically.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="delivery" title="Delivery">
        <ul>
          <li>
            We deliver only to addresses inside the store&rsquo;s delivery radius. Checkout
            checks this before you pay.
          </li>
          <li>
            Delivery times shown are estimates, not guarantees. Traffic, weather and store
            workload can cause delays.
          </li>
          <li>
            Each order has a 4-digit delivery code, shown to you once after you place the
            order. The rider will hand over the order only to someone who gives the correct
            code. Anyone who gives the code is treated as authorised to receive the order, so
            keep it private.
          </li>
          <li>
            The rider may take a photo of the handover as proof of delivery. If nobody is
            available or the code cannot be given, the delivery may be marked as failed.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="cancel" title="Cancellations and refunds">
        <ul>
          <li>
            <strong>Before the store accepts</strong> (while your order is &ldquo;Placed&rdquo;)
            you can cancel free of charge.
          </li>
          <li>
            <strong>After the store accepts</strong>, cancelling needs the store&rsquo;s or our
            approval. Contact support and we will try to help, but we cannot guarantee it once
            your items have been picked or are on their way.
          </li>
          <li>
            If you paid online for an order that is cancelled, rejected or partly fulfilled,
            the amount you are owed is refunded to your original payment method. The time for
            it to reach you depends on your bank or payment provider.
          </li>
          <li>
            If something in your delivery is damaged, wrong, missing or past its expiry date,
            contact us within <Placeholder>number of hours</Placeholder> of delivery with your
            order number and, if possible, a photo.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="conduct" title="Riders and conduct">
        <p>Delivery partners are expected to:</p>
        <ul>
          <li>be courteous, and follow traffic laws and local rules;</li>
          <li>
            collect only the amount shown in the app on a cash order, and never ask for the
            delivery code before they are at your door with your order;
          </li>
          <li>use your contact details only to complete your delivery.</li>
        </ul>
        <p>
          Please treat riders and store staff with respect, give an address they can safely
          reach, and report any misconduct to support. We may suspend any user, store or
          rider who behaves abusively or unsafely.
        </p>
      </InfoSection>

      <InfoSection id="partners" title="Stores and delivery partners">
        <p>
          Stores and delivery partners apply through <Link href="/signup">Sign up</Link> and
          can use {name} only after we approve them. They agree to separate partner terms
          covering commissions, payouts, verification and service standards. Where those
          conflict with these terms for partner activity, the partner terms apply.
        </p>
      </InfoSection>

      <InfoSection id="use" title="Acceptable use">
        <p>You must not:</p>
        <ul>
          <li>use {name} for anything unlawful or fraudulent;</li>
          <li>place orders you do not intend to accept or pay for;</li>
          <li>
            try to get around our security, scrape the service, or interfere with how it works;
          </li>
          <li>use another person&rsquo;s account, payment method or delivery code.</li>
        </ul>
      </InfoSection>

      <InfoSection id="liability" title="Liability">
        <ul>
          <li>
            As a marketplace, we are not the seller of products listed by stores. Claims
            about a product&rsquo;s quality, safety or fitness are against the store, and we
            will help you raise them.
          </li>
          <li>
            We provide {name} &ldquo;as is&rdquo;. We work to keep it available and accurate,
            but cannot promise it will always be uninterrupted or error-free.
          </li>
          <li>
            As far as the law allows, our total liability for any claim about an order is
            limited to the amount you paid for that order. We are not liable for indirect or
            consequential loss.
          </li>
          <li>
            Nothing in these terms limits your rights as a consumer under the Consumer
            Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020, or any
            liability that cannot be limited by law.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="disputes" title="Complaints and disputes">
        <p>
          For any complaint, contact us first. Our grievance officer is{' '}
          <Placeholder>Grievance officer name</Placeholder>. We will acknowledge your
          complaint within 48 hours and try to resolve it within one month.
        </p>
        <ContactCard settings={s} />
        <p>
          These terms are governed by the laws of India. Subject to your rights as a consumer,
          the courts at <Placeholder>city</Placeholder> have jurisdiction.
        </p>
      </InfoSection>

      <InfoSection id="changes" title="Changes">
        <p>
          We may update these terms. The date at the top shows the latest version, and we will
          tell you in the app before a significant change takes effect. Orders already placed
          stay under the terms that applied when you placed them.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
