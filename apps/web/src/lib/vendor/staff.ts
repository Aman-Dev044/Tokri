/**
 * Labels and the password generator for the Staff screen.
 *
 * The permission catalogue and the presets themselves are NOT copied here —
 * the screen reads them from `GET /vendor/staff/roles`, so the checklist can
 * never offer a permission the API does not know or show a preset the API
 * resolves differently.
 */

import type { StaffRole, StorePermission } from './types';

export const PERMISSION_LABEL: Record<StorePermission, { label: string; hint: string }> = {
  'orders.view': { label: 'See orders', hint: 'The order board, order detail and the dashboard' },
  'orders.update': { label: 'Work orders', hint: 'Accept, reject, pack, mark ready, assign a rider' },
  'products.view': { label: 'See products', hint: 'The catalogue and the stock board' },
  'products.manage': { label: 'Edit products', hint: 'Add, edit, delete products and categories' },
  'inventory.adjust': { label: 'Adjust stock', hint: 'Restock and correct quantities' },
  'billing.view': { label: 'See billing', hint: 'The counter screen and sales history' },
  'billing.create': { label: 'Ring up sales', hint: 'Charge walk-in customers at the counter' },
  'billing.void': { label: 'Void sales', hint: 'Cancel a counter sale and restock it' },
  'staff.manage': { label: 'Manage staff', hint: 'Add, edit, suspend and remove staff' },
  'riders.manage': { label: 'Manage riders', hint: "The store's own delivery partners" },
  'earnings.view': { label: 'See earnings', hint: 'Revenue, commission, settlements and reports' },
  'store.manage': { label: 'Run the store', hint: 'Open or close, hours and the store profile' },
};

export const STAFF_ROLE_HINT: Record<StaffRole, string> = {
  MANAGER: 'Everything except the money — no earnings.',
  BILLER: 'The counter: ring up sales and look up products.',
  ORDERS: 'The order board: accept, pack, hand to a rider.',
  INVENTORY: 'Products and stock levels.',
  SUPERVISOR: 'Can look at orders, products and billing, change nothing.',
  CUSTOM: 'Pick exactly what this person can do.',
};

export const STAFF_ROLES: readonly StaffRole[] = [
  'MANAGER',
  'BILLER',
  'ORDERS',
  'INVENTORY',
  'SUPERVISOR',
  'CUSTOM',
];

/** No 0/O, 1/l/I: this is read aloud across a counter and typed on a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * A 16-character first password from the platform CSPRNG.
 *
 * `crypto.getRandomValues` exists in insecure contexts too (unlike
 * `randomUUID`), so this works on the plain-http deployment. Rejection
 * sampling keeps every character equally likely.
 */
export function generatePassword(length = 16): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  const buffer = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte < limit) out.push(ALPHABET[byte % ALPHABET.length] ?? '');
      if (out.length === length) break;
    }
  }
  return out.join('');
}
