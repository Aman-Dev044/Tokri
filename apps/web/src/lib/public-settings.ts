import { API_URL } from '@/config/env';

/**
 * `GET /settings/public` — the six platform settings a signed-out visitor
 * may read. The help, privacy and terms pages render from these, so the
 * support contact and the delivery terms on them are whatever the admin
 * console says today, not a sentence somebody typed into a page last year.
 */
export interface PublicSettings {
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  /** INTEGER PAISE. */
  deliveryFeePaise: number;
  /** INTEGER PAISE. At or above this (after any coupon), delivery is free. */
  freeDeliveryThresholdPaise: number;
  /** Kilometres — the default radius the store list searches. */
  serviceRadiusKm: number;
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Validates the payload; anything off-shape is treated as unavailable. */
export function readPublicSettings(raw: unknown): PublicSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (
    !isText(body.platformName) ||
    !isText(body.supportEmail) ||
    !isText(body.supportPhone) ||
    !isCount(body.deliveryFeePaise) ||
    !isCount(body.freeDeliveryThresholdPaise) ||
    !isCount(body.serviceRadiusKm)
  ) {
    return null;
  }
  return {
    platformName: body.platformName,
    supportEmail: body.supportEmail,
    supportPhone: body.supportPhone,
    deliveryFeePaise: body.deliveryFeePaise,
    freeDeliveryThresholdPaise: body.freeDeliveryThresholdPaise,
    serviceRadiusKm: body.serviceRadiusKm,
  };
}

/**
 * Server-side read, cached for five minutes like the landing page shelf.
 *
 * Returns null rather than throwing: these pages must still render when
 * the API is down, and they say "shown at checkout" / "see the app"
 * instead of printing a number nobody verified.
 */
export async function fetchPublicSettings(): Promise<PublicSettings | null> {
  try {
    const res = await fetch(`${API_URL}/settings/public`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return readPublicSettings(await res.json());
  } catch {
    return null;
  }
}

/** `9876543210` → `+91 98765 43210`, for display only. */
export function formatIndianPhone(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.length === 10) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  return digits;
}

/** `9876543210` → `tel:+919876543210`. */
export function telHref(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  return clean.length === 10 ? `tel:+91${clean}` : `tel:${clean}`;
}
