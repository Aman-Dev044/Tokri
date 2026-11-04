/**
 * Support email and phone, read from `GET /settings/public` — the values an
 * admin sets in the console, not a hard-coded address. When the API cannot be
 * reached the card says so instead of guessing.
 */

import {
  formatIndianPhone,
  telHref,
  type PublicSettings,
} from '@/lib/public-settings';

export function ContactCard({ settings }: { settings: PublicSettings | null }) {
  if (settings === null) {
    return (
      <p>
        Our support contact details could not be loaded just now. Please refresh this
        page in a moment.
      </p>
    );
  }

  return (
    <ul className="hlp-contact">
      <li>
        <a href={`mailto:${settings.supportEmail}`}>
          <span className="hlp-contact__label">Email</span>
          <span className="hlp-contact__value">{settings.supportEmail}</span>
        </a>
      </li>
      <li>
        <a href={telHref(settings.supportPhone)}>
          <span className="hlp-contact__label">Phone</span>
          <span className="hlp-contact__value">
            {formatIndianPhone(settings.supportPhone)}
          </span>
        </a>
      </li>
    </ul>
  );
}
