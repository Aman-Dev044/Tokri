/**
 * The chromatic aisles (§2.1).
 *
 * Every `Category` carries an `aisleKey`, and the customer UI re-tints the
 * whole interface from it. The admin dashboard uses the same key to colour
 * its sales-by-aisle breakdown, which is why the set is a closed enum here
 * rather than a free-text field: an unknown key would render with no hue.
 *
 * ── ELECTRONICS, the ninth ───────────────────────────────────────────────
 * The original eight are all perishables. `ELECTRONICS` was added because
 * the platform owner asked for it by name, and it is deliberately EMPTY of
 * products: the demo catalogue was wiped on purpose, and seeding invented
 * rows into a new aisle would put fake products back in front of the user.
 * The aisle exists, its category exists, and it says "no products yet"
 * until a real vendor lists something in it. That is the honest state.
 *
 * Adding a key here means adding it in THREE more places or the UI renders
 * an uncoloured hole: `packages/design-system/src/aisles.ts` (the `AisleKey`
 * union and the `AISLES` table) and the `--aisle-*` / `[data-aisle=…]`
 * blocks in `packages/design-system/src/tokens/tokens.css`.
 */
export enum AisleKey {
  FRUITS = 'fruits',
  VEGETABLES = 'vegetables',
  DAIRY = 'dairy',
  BAKERY = 'bakery',
  BEVERAGES = 'beverages',
  SNACKS = 'snacks',
  STAPLES = 'staples',
  FROZEN = 'frozen',
  ELECTRONICS = 'electronics',
}

/** Stable display order — matches the table in §2.1. */
export const AISLE_KEYS: readonly AisleKey[] = [
  AisleKey.FRUITS,
  AisleKey.VEGETABLES,
  AisleKey.DAIRY,
  AisleKey.BAKERY,
  AisleKey.BEVERAGES,
  AisleKey.SNACKS,
  AisleKey.STAPLES,
  AisleKey.FROZEN,
  AisleKey.ELECTRONICS,
];
