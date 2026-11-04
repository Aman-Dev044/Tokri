import type { Metadata } from 'next';
import Link from 'next/link';

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
 * /privacy — a TEMPLATE privacy policy for an Indian grocery marketplace.
 *
 * Every factual statement about data handling is checked against the code:
 * argon2 password and delivery-code hashes, rider location pings only while
 * OUT_FOR_DELIVERY with a 7-day TTL (`location-ping.schema.ts`), parked and
 * converted baskets on a 7-day TTL (`cart.schema.ts`), sign-up codes on a
 * 15-minute TTL (`registration-otp.schema.ts`), the optional handover photo
 * (`proof-photo.service.ts`), rider KYC document kinds
 * (`delivery-partner.schema.ts`), store and rider seeing the customer's name
 * and phone (`vendor/orders`, `delivery/types.ts`), and browse location read
 * from the query string, never stored (`GET /stores?lat&lng`).
 *
 * Legal-entity details are deliberately left as visible placeholders: the
 * page must never invent a registration number or an office address.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `What personal data ${APP_NAME} collects, why, who it is shared with, how long it is kept, and your rights under India's DPDP Act, 2023.`,
  alternates: { canonical: '/privacy' },
};

const TOC: readonly TocEntry[] = [
  { id: 'who', label: 'Who we are' },
  { id: 'collect', label: 'What we collect' },
  { id: 'why', label: 'Why we use it' },
  { id: 'share', label: 'Who we share it with' },
  { id: 'keep', label: 'How long we keep it' },
  { id: 'security', label: 'How we protect it' },
  { id: 'rights', label: 'Your rights' },
  { id: 'children', label: 'Children' },
  { id: 'grievance', label: 'Grievance officer' },
  { id: 'changes', label: 'Changes to this policy' },
];

export default async function PrivacyPage() {
  const s = await fetchPublicSettings();
  const name = s?.platformName ?? APP_NAME;

  return (
    <InfoPage
      current="privacy"
      eyebrow="Policies"
      title="Privacy policy"
      lede={`How ${name} collects, uses, shares and protects your personal data.`}
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
      <InfoSection id="who" title="Who we are">
        <p>
          {name} is an online marketplace that connects customers with local grocery stores
          and delivery partners in India. It is operated by{' '}
          <Placeholder>Legal entity name</Placeholder>, with its registered office at{' '}
          <Placeholder>Registered office address</Placeholder> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). For the purposes of the Digital Personal Data Protection Act, 2023
          (&ldquo;DPDP Act&rdquo;), we are the Data Fiduciary for the personal data described
          here.
        </p>
        <p>
          This policy covers customers, and the store owners and delivery partners who use
          {` ${name}`}. By using {name} you agree to the processing described here.
        </p>
      </InfoSection>

      <InfoSection id="collect" title="What we collect">
        <h3>From everyone with an account</h3>
        <ul>
          <li>
            <strong>Identity and contact:</strong> your name, mobile number and, if you give
            it, your email address.
          </li>
          <li>
            <strong>Sign-in:</strong> your password, which we store only as a one-way hash, never
            in readable form. We also set a sign-in cookie in your browser that scripts on the page cannot read.
          </li>
        </ul>

        <h3>From customers</h3>
        <ul>
          <li>
            <strong>Delivery addresses</strong>, including the map pin or PIN code you choose.
          </li>
          <li>
            <strong>Your location while browsing</strong>, only if you allow it in your browser.
            We use it to find stores near you. It is sent with that request and is not saved
            to your account unless you save it as an address.
          </li>
          <li>
            <strong>Orders:</strong> what you bought, from which store, prices, coupons,
            delivery status and its history.
          </li>
          <li>
            <strong>Payments:</strong> payment method, amount and status, plus the reference
            numbers from our payment partner. Card, UPI and bank details are entered with the
            payment partner; we do not receive or store your card number.
          </li>
          <li>
            <strong>Proof of delivery:</strong> the 4-digit delivery code (stored only as a
            hash) and, if the rider takes one, a photo of the handover.
          </li>
          <li>
            <strong>Your basket</strong>, saved on our servers and in your browser so it
            survives a reload.
          </li>
        </ul>

        <h3>From delivery partners</h3>
        <ul>
          <li>
            <strong>Live location while delivering.</strong> The rider app sends its position
            about every ten seconds, but only while an order is out for delivery. We use it to
            show the customer where their order is and to assign nearby orders.
          </li>
          <li>
            <strong>Verification documents</strong> such as Aadhaar, PAN, driving licence,
            vehicle registration and insurance, and a selfie, plus vehicle details.
          </li>
          <li>
            <strong>Earnings and wallet records</strong> for deliveries and cash collected.
          </li>
        </ul>

        <h3>From store owners</h3>
        <ul>
          <li>
            Store name, address and map location, opening hours, catalogue, prices and stock,
            and the details needed to settle payouts.
          </li>
        </ul>

        <h3>Technical data</h3>
        <ul>
          <li>
            Your IP address and request logs, used to keep the service secure and to limit
            abuse such as repeated sign-in attempts.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="why" title="Why we use it">
        <ul>
          <li>To create and secure your account and verify your mobile number.</li>
          <li>
            To show stores that deliver to you, take your order, pass it to the store, and
            get it delivered.
          </li>
          <li>To take payment, issue refunds and keep accounting and tax records.</li>
          <li>To send you updates about your order, in the app and, where enabled, by SMS.</li>
          <li>To approve, pay and support store owners and delivery partners.</li>
          <li>
            To prevent fraud and misuse, resolve disputes, and meet our legal obligations.
          </li>
        </ul>
        <p>
          We process your data on the basis of your consent, and for legitimate uses the DPDP
          Act allows, such as providing a service you have asked for or meeting a legal
          obligation. We do not sell your personal data.
        </p>
      </InfoSection>

      <InfoSection id="share" title="Who we share it with">
        <ul>
          <li>
            <strong>The store you order from</strong> receives your name, mobile number, the
            items you ordered and your delivery address, so it can prepare the order and reach
            you if something is missing.
          </li>
          <li>
            <strong>The delivery partner</strong> who takes your order receives your name,
            mobile number and delivery address and pin, so they can find you. Customers see
            the rider&rsquo;s name and live location while the order is on its way.
          </li>
          <li>
            <strong>Service providers</strong> who work for us under contract: our payment
            partner (Razorpay), SMS provider, cloud hosting, and file storage for photos and
            documents. They may use your data only to provide their service to us.
          </li>
          <li>
            <strong>Authorities</strong>, when the law requires it or to protect the rights and
            safety of our users.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="keep" title="How long we keep it">
        <ul>
          <li>Account details: for as long as your account is open.</li>
          <li>
            Orders, payments and invoices: for <Placeholder>retention period</Placeholder>,
            as required by Indian tax and accounting law, even after you close your account.
          </li>
          <li>Rider location history: deleted automatically after 7 days.</li>
          <li>Parked and completed baskets: deleted automatically after 7 days.</li>
          <li>Mobile verification codes: expire within 15 minutes.</li>
          <li>
            Delivery partner verification documents: for as long as the partner is active,
            and afterwards for <Placeholder>retention period</Placeholder>.
          </li>
        </ul>
        <p>
          When we no longer need personal data for its purpose or by law, we delete it or
          make it anonymous.
        </p>
      </InfoSection>

      <InfoSection id="security" title="How we protect it">
        <p>
          We use reasonable security safeguards. Passwords and delivery codes are stored only
          as one-way hashes, every account can access only what its role needs, a store can
          see only its own orders, and sensitive actions are logged. No system is perfectly
          secure. If a personal data breach affects you, we will tell you and the Data
          Protection Board of India as the DPDP Act requires.
        </p>
      </InfoSection>

      <InfoSection id="rights" title="Your rights">
        <p>Under the DPDP Act, 2023 you can:</p>
        <ul>
          <li>ask for a summary of the personal data we hold about you and how we use it;</li>
          <li>ask us to correct, complete or update it;</li>
          <li>
            ask us to erase it, unless we must keep it by law (for example, tax records);
          </li>
          <li>
            withdraw your consent at any time. This does not affect processing already done,
            and we may no longer be able to serve you;
          </li>
          <li>nominate someone to exercise these rights if you die or become unable to;</li>
          <li>have your complaint dealt with by our grievance officer.</li>
        </ul>
        <p>
          To use any of these rights, email us from the address or mobile number on your
          account. We will reply within <Placeholder>response time</Placeholder>.
        </p>
      </InfoSection>

      <InfoSection id="children" title="Children">
        <p>
          {name} is meant for adults. If you are under 18, please use it only with the
          consent and supervision of a parent or guardian. We do not knowingly target
          children or track their behaviour for advertising.
        </p>
      </InfoSection>

      <InfoSection id="grievance" title="Grievance officer">
        <p>
          If you have a concern about how your personal data is handled, contact our
          grievance officer:
        </p>
        <ul>
          <li>
            Name: <Placeholder>Grievance officer name</Placeholder>
          </li>
          <li>
            Postal address: <Placeholder>Registered office address</Placeholder>
          </li>
        </ul>
        <p>Or reach our support team:</p>
        <ContactCard settings={s} />
        <p>
          If you are not satisfied with our response, you may complain to the Data
          Protection Board of India.
        </p>
      </InfoSection>

      <InfoSection id="changes" title="Changes to this policy">
        <p>
          We may update this policy as {name} or the law changes. The date at the top shows
          the latest version. If a change is significant, we will tell you in the app before
          it takes effect. See also our <Link href="/terms">terms of service</Link>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
