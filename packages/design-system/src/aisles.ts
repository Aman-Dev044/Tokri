/**
 * MANDI - the chromatic aisles.
 *
 * This is the single source of truth for Pillar 1. The `key` here is exactly
 * what gets stamped onto `<html data-aisle="...">`, and exactly what the CSS in
 * `tokens/tokens.css` keys off. Adding an aisle means adding it in both places,
 * AND in `AisleKey` in `apps/api/src/common/constants/aisle.enum.ts` - the API
 * validates `?aisleKey=` against a closed enum, so a key the UI knows and the
 * API does not is a 400 on every tap of that tile.
 *
 * `swatch` duplicates the hue as a literal ONLY so React can paint a preview
 * chip before the attribute swap lands. Components must otherwise read
 * `var(--aisle)` - nothing in the UI hardcodes a colour.
 *
 * `items` is MARKETING COPY for the landing page and the ticker, not
 * catalogue. It is deliberately EMPTY for `electronics`: that aisle was added
 * because the platform owner asked for it by name, and nothing real is listed
 * in it yet. Writing six plausible-looking gadgets here would put invented
 * products back on the landing page of an app whose demo data was wiped on
 * purpose. An aisle that shows "0 items" and an empty shelf is the honest
 * state, and it fixes itself the day a vendor lists a real product.
 */

export type AisleKey =
  | 'fruits'
  | 'vegetables'
  | 'dairy'
  | 'bakery'
  | 'beverages'
  | 'snacks'
  | 'staples'
  | 'frozen'
  | 'electronics';

export interface Aisle {
  /** stamped on <html data-aisle> */
  readonly key: AisleKey;
  /** display name, English */
  readonly name: string;
  /** display name, Devanagari - the market these aisles come from */
  readonly hindi: string;
  /** the produce the hue is taken from */
  readonly source: string;
  /** identity hue, for preview chips only */
  readonly swatch: string;
  /** one line of real catalogue copy */
  readonly blurb: string;
  /** representative items, used on the landing page and the ticker */
  readonly items: ReadonlyArray<{ name: string; unit: string; paise: number }>;
}

export const AISLES: readonly Aisle[] = [
  {
    key: 'fruits',
    name: 'Fruits',
    hindi: 'फल',
    source: 'tomato skin',
    swatch: '#D64530',
    blurb: 'Picked at dawn from Devanahalli and Nashik, graded the same morning.',
    items: [
      { name: 'Alphonso Mango', unit: '1 kg', paise: 42900 },
      { name: 'Nagpur Santra', unit: '1 kg', paise: 11900 },
      { name: 'Banganapalli Mango', unit: '1 kg', paise: 18500 },
      { name: 'Pomegranate Bhagwa', unit: '500 g', paise: 14900 },
      { name: 'Shimla Apple', unit: '4 pc', paise: 19900 },
      { name: 'Sweet Lime', unit: '1 kg', paise: 8900 },
    ],
  },
  {
    key: 'vegetables',
    name: 'Vegetables',
    hindi: 'सब्ज़ी',
    source: 'coriander leaf',
    swatch: '#4E8C3F',
    blurb: 'Cut, weighed and bagged after you order. Nothing sits under a lamp.',
    items: [
      { name: 'Tomato Hybrid', unit: '1 kg', paise: 3400 },
      { name: 'Onion Nashik', unit: '1 kg', paise: 3800 },
      { name: 'Lady Finger', unit: '500 g', paise: 2900 },
      { name: 'Coriander Bunch', unit: '100 g', paise: 1500 },
      { name: 'Green Chilli', unit: '250 g', paise: 1900 },
      { name: 'Potato Jyoti', unit: '2 kg', paise: 6400 },
    ],
  },
  {
    key: 'dairy',
    name: 'Dairy & Eggs',
    hindi: 'दूध',
    source: 'fresh butter',
    swatch: '#C89B3C',
    blurb: 'Cold chain held at 4°C from the dairy to the doorstep. No exceptions.',
    items: [
      { name: 'Amul Taaza Milk', unit: '500 ml', paise: 2800 },
      { name: 'Paneer Fresh', unit: '200 g', paise: 9500 },
      { name: 'Farm Eggs', unit: '6 pc', paise: 5400 },
      { name: 'Dahi Cup', unit: '400 g', paise: 4500 },
      { name: 'Amul Butter', unit: '100 g', paise: 6200 },
      { name: 'Malai Paneer', unit: '500 g', paise: 22000 },
    ],
  },
  {
    key: 'bakery',
    name: 'Bakery',
    hindi: 'बेकरी',
    source: 'baked crust',
    swatch: '#B5651D',
    blurb: 'Baked between 4am and 6am. We stop listing a loaf once it is a day old.',
    items: [
      { name: 'Atta Bread', unit: '400 g', paise: 4500 },
      { name: 'Pav Bun', unit: '6 pc', paise: 3000 },
      { name: 'Khari Biscuit', unit: '200 g', paise: 5500 },
      { name: 'Multigrain Loaf', unit: '450 g', paise: 6900 },
      { name: 'Butter Croissant', unit: '2 pc', paise: 11000 },
      { name: 'Rusk Toast', unit: '300 g', paise: 4200 },
    ],
  },
  {
    key: 'beverages',
    name: 'Beverages',
    hindi: 'पेय',
    source: 'deep water',
    swatch: '#2F6F8C',
    blurb: 'Chilled stock only. If it is not cold at the store, it is not listed.',
    items: [
      { name: 'Tender Coconut', unit: '1 pc', paise: 5500 },
      { name: 'Fresh Lime Soda', unit: '300 ml', paise: 4000 },
      { name: 'Masala Chaas', unit: '200 ml', paise: 2500 },
      { name: 'Cold Press Orange', unit: '250 ml', paise: 8900 },
      { name: 'Filter Coffee Decoction', unit: '200 ml', paise: 9900 },
      { name: 'Nimbu Pani Kit', unit: '1 pack', paise: 6500 },
    ],
  },
  {
    key: 'snacks',
    name: 'Snacks',
    hindi: 'नमकीन',
    source: 'jamun berry',
    swatch: '#8C4A6B',
    blurb: 'Regional namkeen from the people who actually make it, not a white label.',
    items: [
      { name: 'Bhavnagari Gathiya', unit: '250 g', paise: 8000 },
      { name: 'Ratlami Sev', unit: '200 g', paise: 7500 },
      { name: 'Roasted Makhana', unit: '100 g', paise: 12500 },
      { name: 'Banana Chips', unit: '200 g', paise: 9000 },
      { name: 'Murukku', unit: '250 g', paise: 8500 },
      { name: 'Aam Papad', unit: '150 g', paise: 7000 },
    ],
  },
  {
    key: 'staples',
    name: 'Staples & Grains',
    hindi: 'किराना',
    source: 'wheat husk',
    swatch: '#6B6244',
    blurb: 'Milled to order where the vendor supports it. Batch date on every pack.',
    items: [
      { name: 'Sona Masoori Rice', unit: '5 kg', paise: 42000 },
      { name: 'Chakki Atta', unit: '5 kg', paise: 26500 },
      { name: 'Toor Dal', unit: '1 kg', paise: 16900 },
      { name: 'Mustard Oil', unit: '1 L', paise: 17500 },
      { name: 'Rock Salt', unit: '1 kg', paise: 4500 },
      { name: 'Basmati Aged', unit: '1 kg', paise: 18900 },
    ],
  },
  {
    key: 'frozen',
    name: 'Frozen',
    hindi: 'फ़्रोज़न',
    source: 'frost on glass',
    swatch: '#4A7C8C',
    blurb: 'Insulated bag on every frozen order. No surcharge, no soggy handover.',
    items: [
      { name: 'Green Peas', unit: '500 g', paise: 9500 },
      { name: 'Aloo Tikki', unit: '400 g', paise: 12500 },
      { name: 'Malabar Paratha', unit: '5 pc', paise: 11000 },
      { name: 'Sweet Corn', unit: '500 g', paise: 10500 },
      { name: 'Veg Momos', unit: '10 pc', paise: 16500 },
      { name: 'Kulfi Malai', unit: '4 pc', paise: 14000 },
    ],
  },
  {
    key: 'electronics',
    name: 'Electronics',
    hindi: 'इलेक्ट्रॉनिक्स',
    source: 'anodised steel',
    swatch: '#5C6BC0',
    blurb: 'Nothing listed here yet. The aisle is open for vendors to stock.',
    // Empty on purpose - see the file header. Real rows only.
    items: [],
  },
];

export const AISLE_KEYS: readonly AisleKey[] = AISLES.map((a) => a.key);

export function getAisle(key: AisleKey): Aisle {
  const found = AISLES.find((a) => a.key === key);
  if (!found) throw new Error(`Unknown aisle key: ${key}`);
  return found;
}

export function isAisleKey(value: string): value is AisleKey {
  return AISLES.some((a) => a.key === value);
}

/**
 * Money is INTEGER PAISE everywhere in Mandi (plan section 5.2). Floats produce
 * settlement reports that are off by a few paise and take a week to debug.
 * This formatter is the only place paise becomes a human-readable rupee string.
 */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}
