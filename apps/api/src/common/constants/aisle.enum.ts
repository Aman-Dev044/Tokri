/**
 * The eight chromatic aisles (§2.1).
 *
 * Every `Category` carries an `aisleKey`, and the customer UI re-tints the
 * whole interface from it. The admin dashboard uses the same key to colour
 * its sales-by-aisle breakdown, which is why the set is a closed enum here
 * rather than a free-text field: an unknown key would render with no hue.
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
];
