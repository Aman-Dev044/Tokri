/**
 * ════════════════════════════════════════════════════════════════════════
 *  A PHOTOGRAPH FOR EACH THING ON THE SHELF
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every product used to seed with `images: []`, so the whole catalogue
 * rendered as letter-in-a-circle plates. That reads as a shop that has not
 * been stocked yet.
 *
 * ── Where the files come from ───────────────────────────────────────────
 * They are SELF-HOSTED, in `apps/web/public/products/`, downloaded once
 * from Wikimedia Commons. Nothing is hotlinked: there is no CDN to allow
 * through the CSP, no third party that can rate-limit the shop, and no
 * stranger who can delete a photo and leave a hole in the catalogue.
 *
 * Commons was chosen over a stock-photo CDN for one reason: the FILENAME
 * declares the subject. A photo id that returns 200 proves only that the
 * id exists — one candidate for the LED bulb turned out to be a photograph
 * of an electric guitar. `LED_bulb.jpg` cannot be a guitar.
 *
 * ── Why a keyword table and not a per-product field ─────────────────────
 * A product named here is matched on what it IS, not on its exact row, so
 * a new "Shimla Apple" or "Himalayan Apple" picks up the apple photograph
 * the day it is added, without anyone remembering to wire an image. The
 * table is ordered longest-key-first so `sweet corn` wins over `corn` and
 * `banana chips` wins over `banana`.
 *
 * ── What is deliberately missing ────────────────────────────────────────
 * Five subjects had no usable file on Commons: mosambi, toor dal, chana
 * dal, besan and the mosquito vaporiser. They resolve to `null` and keep
 * the letter plate. Showing an orange for a sweet lime, or mung beans for
 * toor dal, would be a picture of the wrong food on a grocery listing —
 * worse than an honest placeholder, because a customer would believe it.
 */

/** Public URL of a file in `apps/web/public/products/`. */
const file = (name: string): string => `/products/${name}.jpg`;

/**
 * Keyword -> image, longest key first. The key is matched case-insensitively
 * against the product name.
 */
const BY_KEYWORD: ReadonlyArray<readonly [string, string]> = (
  [
    // fruit
    ['alphonso mango', 'mango'],
    ['mango', 'mango'],
    ['banana chips', 'chips'],
    ['banana', 'banana'],
    ['pomegranate', 'pomegranate'],
    ['apple', 'apple'],
    ['papaya', 'papaya'],
    ['grapes', 'grapes'],
    ['watermelon', 'watermelon'],
    ['guava', 'guava'],
    ['orange', 'orange'],

    // vegetables
    ['tomato', 'tomato'],
    ['onion', 'onion'],
    ['potato', 'potato'],
    ['lady finger', 'okra'],
    ['bhindi', 'okra'],
    ['coriander', 'coriander'],
    ['chilli', 'chilli'],
    ['carrot', 'carrot'],
    ['cauliflower', 'cauliflower'],
    ['palak', 'spinach'],
    ['spinach', 'spinach'],
    ['ginger', 'ginger'],

    // dairy
    ['milk', 'milk'],
    ['curd', 'curd'],
    ['dahi', 'curd'],
    ['butter biscuit', 'biscuit'],
    ['butter', 'butter'],
    ['cheese', 'cheese'],
    ['egg', 'egg'],
    ['paneer', 'paneer'],
    ['ghee', 'ghee'],
    ['lassi', 'lassi'],

    // bakery
    ['garlic bread', 'bread'],
    ['bread', 'bread'],
    ['pav', 'bread'],
    ['pastry', 'pastry'],
    ['honey cake', 'pastry'],
    ['rusk', 'rusk'],
    ['biscuit', 'biscuit'],
    ['good day', 'biscuit'],
    ['parle-g', 'biscuit'],
    ['dark fantasy', 'biscuit'],
    ['veg puff', 'pastry'],
    ['dil pasand', 'pastry'],

    // beverages
    ['tea', 'tea'],
    ['coffee', 'coffee'],
    ['juice', 'juice'],
    ['aam panna', 'juice'],
    ['coca-cola', 'cola'],
    ['thums up', 'cola'],
    ['mineral water', 'water'],
    ['coconut water', 'coconut'],
    ['kool badam', 'milk'],

    // snacks
    ['chips', 'chips'],
    ['lays', 'chips'],
    ['kurkure', 'namkeen'],
    ['mixture', 'namkeen'],
    ['murukku', 'namkeen'],
    ['peanut', 'peanut'],
    ['soan papdi', 'soanpapdi'],

    // staples
    ['basmati rice', 'basmati'],
    ['sona masoori', 'rice'],
    ['rice', 'rice'],
    ['moong dal', 'moong'],
    ['atta', 'atta'],
    ['sunflower oil', 'oil'],
    ['sugar', 'sugar'],
    ['salt', 'salt'],

    // frozen
    ['french fries', 'fries'],
    ['green peas', 'peas'],
    ['sweet corn', 'corn'],
    ['nuggets', 'nuggets'],
    ['ice cream', 'icecream'],
    ['cornetto', 'icecream'],
    ['paratha', 'paratha'],
    ['idli', 'idli'],
    ['spring roll', 'springroll'],
    ['mixed vegetables', 'peas'],

    // home & electronics
    ['led bulb', 'bulb'],
    ['extension board', 'extension'],
    ['charging cable', 'cable'],
    ['electric kettle', 'kettle'],
    ['mixer grinder', 'grinder'],
    ['immersion rod', 'immersion'],
    ['table fan', 'fan'],
    ['wall clock', 'clock'],
  ] as ReadonlyArray<readonly [string, string]>
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length);

/**
 * The photograph for a product, or `null` when there is no honest match.
 *
 * `null` is a real answer, not a failure: the shop already draws a labelled
 * plate for a product with no photo, and that is the correct thing to show
 * rather than a picture of something else.
 */
export function imageForProduct(name: string): string | null {
  const needle = name.toLowerCase();
  for (const [keyword, image] of BY_KEYWORD) {
    if (needle.includes(keyword)) return file(image);
  }
  return null;
}
