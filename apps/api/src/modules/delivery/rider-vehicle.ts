import { ValidationOptions, registerDecorator } from 'class-validator';

import { KycDocumentKind } from '../../database/schemas/delivery-partner.schema';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER'S VEHICLE — formats, normalisation and insurance standing
 * ════════════════════════════════════════════════════════════════════════
 *
 * One file for every rule about the vehicle half of KYC, so the DTO that
 * validates a plate, the service that compares one, and the admin list
 * that flags an expiring policy cannot each grow their own idea of what
 * "valid" or "expiring" means.
 */

/** A policy inside this many days of its last covered day is flagged. */
export const INSURANCE_WARN_DAYS = 30;

/**
 * Where the policy stands TODAY, in India.
 *
 *   not_provided   no expiry date on file (a bicycle, or not sent yet)
 *   valid          more than `INSURANCE_WARN_DAYS` days of cover left
 *   expiring_soon  0..`INSURANCE_WARN_DAYS` days left — today included
 *   expired        the last covered day is already behind us
 *
 * Computed on every read, never stored: a stored "valid" would quietly
 * become a lie at midnight.
 */
export type InsuranceStanding =
  | 'not_provided'
  | 'valid'
  | 'expiring_soon'
  | 'expired';

/**
 * State and union-territory codes as painted on a standard plate.
 *
 * Kept as a set rather than `[A-Z]{2}` because a two-letter prefix is
 * the one part of a plate that is a closed list, and `ZZ` is a typo a
 * reviewer would otherwise spend their SLA on. Both spellings of the
 * renamed states (OR/OD, UA/UK, TS/TG) are in: old plates are not
 * re-issued when a code changes.
 */
const STATE_CODES: ReadonlySet<string> = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ',
  'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP',
  'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TG', 'TN', 'TR', 'TS',
  'UA', 'UK', 'UP', 'WB',
]);

/** `DL 8S AB 2048`: state, RTO district, an optional series, the number. */
const STANDARD_PLATE = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;

/** `22 BH 1234 AA`: year of registration, BH, four digits, one or two letters. */
const BH_PLATE = /^\d{2}BH\d{4}[A-Z]{1,2}$/;

/** RC numbers have no single national format; this bounds it to sane. */
export const RC_NUMBER = /^[A-Z0-9]{6,20}$/;

/**
 * Insurers print policy numbers with slashes and dashes
 * (`3005/123456789/00/000`), so those survive normalisation — but never
 * at either end, where they are always a stray keystroke.
 */
export const POLICY_NUMBER = /^[A-Z0-9][A-Z0-9/-]{4,28}[A-Z0-9]$/;

/** The vehicle document kinds — the ones a VERIFIED rider may still send. */
export const VEHICLE_DOCUMENT_KINDS: ReadonlySet<KycDocumentKind> = new Set([
  KycDocumentKind.VEHICLE_RC,
  KycDocumentKind.VEHICLE_INSURANCE,
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60_000;

/** Furthest ahead a policy may run: a new two-wheeler's TP cover is 5 years. */
const MAX_YEARS_AHEAD = 6;
const EARLIEST_EXPIRY = Date.UTC(2000, 0, 1);

// ── Normalisation ───────────────────────────────────────────────────────

/** `dl-8s ab 2048` → `DL8SAB2048`. Spaces and dashes are how plates are written, not part of them. */
export function normalisePlate(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/[\s-]+/g, '').toUpperCase()
    : value;
}

/** RC numbers drop spaces and dashes for the same reason a plate does. */
export function normaliseRcNumber(value: unknown): unknown {
  return normalisePlate(value);
}

/** Policy numbers keep their slashes and dashes; only spaces go. */
export function normalisePolicyNumber(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').toUpperCase()
    : value;
}

export function isIndianPlate(plate: string): boolean {
  if (BH_PLATE.test(plate)) return true;
  const match = STANDARD_PLATE.exec(plate);
  return match !== null && STATE_CODES.has(match[1] ?? '');
}

// ── Dates ───────────────────────────────────────────────────────────────

/**
 * `2027-03-31` → that day at 00:00 UTC, or null if it is not a real day.
 *
 * Round-tripped rather than trusted: `new Date('2027-02-30')` is a valid
 * Date in March, and a policy expiring on a day that does not exist is a
 * typo, not a date.
 */
export function parseCalendarDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/** The inverse: a stored day back to `YYYY-MM-DD`. */
export function toCalendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in India, as 00:00 UTC of that calendar day. */
function todayInIndia(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

/**
 * The policy's standing, and whole days of cover left (negative once
 * expired). The expiry date is the LAST covered day, so a policy that
 * expires today has 0 days left and is still in force.
 */
export function insuranceStanding(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): { status: InsuranceStanding; daysLeft: number | null } {
  if (!expiresAt) return { status: 'not_provided', daysLeft: null };

  const daysLeft = Math.round((expiresAt.getTime() - todayInIndia(now)) / DAY_MS);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= INSURANCE_WARN_DAYS) return { status: 'expiring_soon', daysLeft };
  return { status: 'valid', daysLeft };
}

// ── Decorators ──────────────────────────────────────────────────────────

/** A standard state-series or BH-series plate, AFTER `normalisePlate`. */
export function IsIndianPlate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isIndianPlate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message:
          'vehicleRegistrationNumber must be an Indian plate like DL8SAB2048 or 22BH1234AA',
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isIndianPlate(value),
      },
    });
}

/**
 * A real calendar day, `YYYY-MM-DD`, no earlier than 2000 and no more
 * than `MAX_YEARS_AHEAD` years out.
 *
 * An ALREADY-EXPIRED policy passes. Refusing it would stop a rider
 * recording the truth about their vehicle; it is flagged instead, on
 * their screen and in the admin console, where a human decides.
 */
export function IsInsuranceExpiry(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isInsuranceExpiry',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message:
          'vehicleInsuranceExpiresOn must be a real date (YYYY-MM-DD) within the next six years',
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          const day = parseCalendarDay(value);
          if (!day) return false;
          const latest = new Date();
          latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD);
          return day.getTime() >= EARLIEST_EXPIRY && day.getTime() <= latest.getTime();
        },
      },
    });
}
