import { AisleKey } from '../../common/constants/aisle.enum';
import { ProductUnit } from '../schemas/product.schema';
import { VendorStatus } from '../schemas/vendor.schema';
import { VehicleType } from '../schemas/delivery-partner.schema';

/**
 * The static half of the demo dataset — the names, prices and places.
 *
 * EVERY price is INTEGER PAISE. Rs 429 is 42900, never 429 and never
 * 429.00. The generator in `seed-demo.service.ts` never divides, so a
 * float can only enter the data set by being typed into this file.
 */

export interface DemoVendorSpec {
  storeName: string;
  slug: string;
  ownerName: string;
  /** 10 digits; the generator guarantees these stay unique. */
  ownerPhone: string;
  city: string;
  state: string;
  pincode: string;
  line1: string;
  /** [lng, lat] — GeoJSON order, not the [lat, lng] a map UI shows. */
  lng: number;
  lat: number;
  commissionPct: number;
  status: VendorStatus;
  codEnabled: boolean;
  rating: number;
  description: string;
}

export const DEMO_VENDORS: readonly DemoVendorSpec[] = [
  {
    storeName: 'Sri Lakshmi Kirana Store',
    slug: 'sri-lakshmi-kirana',
    ownerName: 'Ramesh Iyer',
    ownerPhone: '9810100101',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560041',
    line1: '14, 4th Block, Jayanagar',
    lng: 77.5833,
    lat: 12.925,
    commissionPct: 12,
    status: VendorStatus.APPROVED,
    codEnabled: true,
    rating: 4.6,
    description: 'Neighbourhood kirana running since 1987. Staples, spices and daily needs.',
  },
  {
    storeName: 'Ganesh Fresh Mart',
    slug: 'ganesh-fresh-mart',
    ownerName: 'Suresh Gowda',
    ownerPhone: '9810100102',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    line1: '22, 100 Feet Road, Indiranagar',
    lng: 77.6408,
    lat: 12.9784,
    commissionPct: 14,
    status: VendorStatus.APPROVED,
    codEnabled: true,
    rating: 4.4,
    description: 'Fruit and vegetable specialist. Twice-daily deliveries from the city mandi.',
  },
  {
    storeName: 'Nandini Dairy Point',
    slug: 'nandini-dairy-point',
    ownerName: 'Lakshmi Prasad',
    ownerPhone: '9810100103',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560034',
    line1: '7, 80 Feet Road, Koramangala',
    lng: 77.6245,
    lat: 12.9352,
    commissionPct: 10,
    status: VendorStatus.APPROVED,
    codEnabled: true,
    rating: 4.7,
    description: 'Milk, curd, paneer and ghee. Cold chain maintained end to end.',
  },
  {
    storeName: 'Iyengar Bakery House',
    slug: 'iyengar-bakery-house',
    ownerName: 'Venkatesh Rao',
    ownerPhone: '9810100104',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560004',
    line1: '3, Gandhi Bazaar, Basavanagudi',
    lng: 77.573,
    lat: 12.941,
    commissionPct: 15,
    status: VendorStatus.APPROVED,
    codEnabled: true,
    rating: 4.8,
    description: 'Fresh bakes from 5am. Honey cake, dil pasand and the original butter biscuit.',
  },
  {
    storeName: 'Mumbai Daily Needs',
    slug: 'mumbai-daily-needs',
    ownerName: 'Nitin Deshmukh',
    ownerPhone: '9810100105',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400053',
    line1: '19, Lokhandwala Complex, Andheri West',
    lng: 72.8479,
    lat: 19.1197,
    commissionPct: 13,
    status: VendorStatus.APPROVED,
    codEnabled: true,
    rating: 4.3,
    description: 'Everything for the week, delivered across the western suburbs.',
  },
  {
    storeName: 'Shree Ram Provision Stores',
    slug: 'shree-ram-provision',
    ownerName: 'Mahesh Jadhav',
    ownerPhone: '9810100106',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400028',
    line1: '5, Ranade Road, Dadar West',
    lng: 72.842,
    lat: 19.0176,
    commissionPct: 13,
    // Suspended: the admin dashboard needs a real suspended row to render.
    status: VendorStatus.SUSPENDED,
    codEnabled: false,
    rating: 3.6,
    description: 'Provisions and dry goods. Currently suspended pending an FSSAI re-check.',
  },
  {
    storeName: 'Green Basket Organics',
    slug: 'green-basket-organics',
    ownerName: 'Ananya Sharma',
    ownerPhone: '9810100107',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560102',
    line1: '11, 27th Main, HSR Layout Sector 2',
    lng: 77.6446,
    lat: 12.9116,
    commissionPct: 16,
    // Pending: so the approval queue is never an empty state.
    status: VendorStatus.PENDING,
    codEnabled: true,
    rating: 0,
    description: 'Certified organic produce sourced from farms around Kanakapura.',
  },
  {
    storeName: 'Sagar Super Bazaar',
    slug: 'sagar-super-bazaar',
    ownerName: 'Faisal Shaikh',
    ownerPhone: '9810100108',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400050',
    line1: '42, Hill Road, Bandra West',
    lng: 72.8296,
    lat: 19.0596,
    commissionPct: 14,
    status: VendorStatus.PENDING,
    codEnabled: true,
    rating: 0,
    description: 'Large-format neighbourhood supermarket. Awaiting onboarding approval.',
  },
];

export interface DemoCategorySpec {
  name: string;
  slug: string;
  aisleKey: AisleKey;
  sortOrder: number;
}

/** One category per aisle key, so every chart series has real data. */
export const DEMO_CATEGORIES: readonly DemoCategorySpec[] = [
  { name: 'Fresh Fruits', slug: 'fresh-fruits', aisleKey: AisleKey.FRUITS, sortOrder: 1 },
  { name: 'Fresh Vegetables', slug: 'fresh-vegetables', aisleKey: AisleKey.VEGETABLES, sortOrder: 2 },
  { name: 'Dairy & Eggs', slug: 'dairy-and-eggs', aisleKey: AisleKey.DAIRY, sortOrder: 3 },
  { name: 'Bakery', slug: 'bakery', aisleKey: AisleKey.BAKERY, sortOrder: 4 },
  { name: 'Beverages', slug: 'beverages', aisleKey: AisleKey.BEVERAGES, sortOrder: 5 },
  { name: 'Snacks & Namkeen', slug: 'snacks-and-namkeen', aisleKey: AisleKey.SNACKS, sortOrder: 6 },
  { name: 'Staples & Grains', slug: 'staples-and-grains', aisleKey: AisleKey.STAPLES, sortOrder: 7 },
  { name: 'Frozen Foods', slug: 'frozen-foods', aisleKey: AisleKey.FROZEN, sortOrder: 8 },
  // Last in the rail on purpose: it is the one non-perishable aisle, and a
  // grocery run starts with food.
  { name: 'Home & Electronics', slug: 'home-and-electronics', aisleKey: AisleKey.ELECTRONICS, sortOrder: 9 },
];

export interface DemoProductSpec {
  name: string;
  brand: string | null;
  aisleKey: AisleKey;
  unit: ProductUnit;
  unitValue: number;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE. Never above `mrp`. */
  price: number;
}

const F = AisleKey.FRUITS;
const V = AisleKey.VEGETABLES;
const D = AisleKey.DAIRY;
const B = AisleKey.BAKERY;
const BV = AisleKey.BEVERAGES;
const S = AisleKey.SNACKS;
const ST = AisleKey.STAPLES;
const FZ = AisleKey.FROZEN;
const EL = AisleKey.ELECTRONICS;

const KG = ProductUnit.KG;
const G = ProductUnit.G;
const L = ProductUnit.L;
const ML = ProductUnit.ML;
const PC = ProductUnit.PIECE;
const PK = ProductUnit.PACK;

/** 90 real products, ten per aisle across nine aisles. */
export const DEMO_PRODUCTS: readonly DemoProductSpec[] = [
  // ── Fruits ──────────────────────────────────────────────────────────
  { name: 'Alphonso Mango', brand: 'Ratnagiri', aisleKey: F, unit: KG, unitValue: 1, mrp: 49900, price: 42900 },
  { name: 'Banana Robusta', brand: null, aisleKey: F, unit: KG, unitValue: 1, mrp: 6500, price: 5900 },
  { name: 'Pomegranate Bhagwa', brand: null, aisleKey: F, unit: G, unitValue: 500, mrp: 11500, price: 9900 },
  { name: 'Kashmiri Apple', brand: null, aisleKey: F, unit: KG, unitValue: 1, mrp: 21900, price: 18900 },
  { name: 'Sweet Lime Mosambi', brand: null, aisleKey: F, unit: KG, unitValue: 1, mrp: 8900, price: 7900 },
  { name: 'Papaya Semi Ripe', brand: null, aisleKey: F, unit: PC, unitValue: 1, mrp: 6500, price: 5500 },
  { name: 'Green Seedless Grapes', brand: null, aisleKey: F, unit: G, unitValue: 500, mrp: 9900, price: 8900 },
  { name: 'Watermelon Kiran', brand: null, aisleKey: F, unit: PC, unitValue: 1, mrp: 8900, price: 7900 },
  { name: 'Guava Allahabadi', brand: null, aisleKey: F, unit: G, unitValue: 500, mrp: 6500, price: 5500 },
  { name: 'Nagpur Orange', brand: null, aisleKey: F, unit: KG, unitValue: 1, mrp: 14900, price: 12900 },

  // ── Vegetables ──────────────────────────────────────────────────────
  { name: 'Tomato Local', brand: null, aisleKey: V, unit: KG, unitValue: 1, mrp: 4500, price: 3900 },
  { name: 'Onion Nashik', brand: null, aisleKey: V, unit: KG, unitValue: 1, mrp: 4900, price: 4200 },
  { name: 'Potato Agra', brand: null, aisleKey: V, unit: KG, unitValue: 1, mrp: 3900, price: 3500 },
  { name: 'Lady Finger Bhindi', brand: null, aisleKey: V, unit: G, unitValue: 500, mrp: 3900, price: 3200 },
  { name: 'Coriander Leaves', brand: null, aisleKey: V, unit: G, unitValue: 100, mrp: 1900, price: 1500 },
  { name: 'Green Chilli', brand: null, aisleKey: V, unit: G, unitValue: 100, mrp: 1500, price: 1200 },
  { name: 'Carrot Ooty', brand: null, aisleKey: V, unit: G, unitValue: 500, mrp: 3900, price: 3400 },
  { name: 'Cauliflower', brand: null, aisleKey: V, unit: PC, unitValue: 1, mrp: 4900, price: 4500 },
  { name: 'Palak Spinach', brand: null, aisleKey: V, unit: G, unitValue: 250, mrp: 2500, price: 1900 },
  { name: 'Ginger', brand: null, aisleKey: V, unit: G, unitValue: 250, mrp: 4500, price: 3900 },

  // ── Dairy & Eggs ────────────────────────────────────────────────────
  { name: 'Amul Taaza Toned Milk', brand: 'Amul', aisleKey: D, unit: ML, unitValue: 500, mrp: 2800, price: 2800 },
  { name: 'Nandini Fresh Curd', brand: 'Nandini', aisleKey: D, unit: G, unitValue: 500, mrp: 3200, price: 3000 },
  { name: 'Amul Butter Salted', brand: 'Amul', aisleKey: D, unit: G, unitValue: 500, mrp: 28000, price: 26500 },
  { name: 'Amul Cheese Slices', brand: 'Amul', aisleKey: D, unit: G, unitValue: 200, mrp: 14500, price: 13500 },
  { name: 'Farm Fresh Eggs', brand: null, aisleKey: D, unit: PC, unitValue: 6, mrp: 6000, price: 5400 },
  { name: 'Malai Paneer', brand: 'Milky Mist', aisleKey: D, unit: G, unitValue: 200, mrp: 10500, price: 9500 },
  { name: 'Nandini Cow Ghee', brand: 'Nandini', aisleKey: D, unit: ML, unitValue: 500, mrp: 34900, price: 32500 },
  { name: 'Mother Dairy Lassi', brand: 'Mother Dairy', aisleKey: D, unit: ML, unitValue: 200, mrp: 2500, price: 2500 },
  { name: 'Amul Masti Dahi', brand: 'Amul', aisleKey: D, unit: G, unitValue: 400, mrp: 3800, price: 3500 },
  { name: 'Milky Mist Curd Cup', brand: 'Milky Mist', aisleKey: D, unit: G, unitValue: 100, mrp: 1500, price: 1500 },

  // ── Bakery ──────────────────────────────────────────────────────────
  { name: 'Brown Bread', brand: 'Britannia', aisleKey: B, unit: G, unitValue: 400, mrp: 5500, price: 5500 },
  { name: 'Iyengar Butter Biscuits', brand: null, aisleKey: B, unit: G, unitValue: 250, mrp: 9000, price: 8000 },
  { name: 'Whole Wheat Pav', brand: null, aisleKey: B, unit: PC, unitValue: 6, mrp: 3900, price: 3500 },
  { name: 'Chocolate Truffle Pastry', brand: null, aisleKey: B, unit: PC, unitValue: 1, mrp: 9900, price: 9000 },
  { name: 'Rusk Toast', brand: 'Britannia', aisleKey: B, unit: G, unitValue: 300, mrp: 6000, price: 5500 },
  { name: 'Multigrain Bread', brand: 'Modern', aisleKey: B, unit: G, unitValue: 400, mrp: 7000, price: 6500 },
  { name: 'Veg Puff', brand: null, aisleKey: B, unit: PC, unitValue: 1, mrp: 3000, price: 2500 },
  { name: 'Dil Pasand', brand: null, aisleKey: B, unit: PC, unitValue: 1, mrp: 4000, price: 3500 },
  { name: 'Honey Cake', brand: null, aisleKey: B, unit: G, unitValue: 250, mrp: 12000, price: 11000 },
  { name: 'Garlic Bread Sticks', brand: null, aisleKey: B, unit: G, unitValue: 200, mrp: 11000, price: 9900 },

  // ── Beverages ───────────────────────────────────────────────────────
  { name: 'Tata Tea Gold', brand: 'Tata', aisleKey: BV, unit: G, unitValue: 500, mrp: 32000, price: 29500 },
  { name: 'Bru Instant Coffee', brand: 'Bru', aisleKey: BV, unit: G, unitValue: 200, mrp: 51000, price: 47500 },
  { name: 'Real Mixed Fruit Juice', brand: 'Real', aisleKey: BV, unit: L, unitValue: 1, mrp: 12500, price: 11000 },
  { name: 'Coca-Cola', brand: 'Coca-Cola', aisleKey: BV, unit: ML, unitValue: 750, mrp: 4500, price: 4000 },
  { name: 'Bisleri Mineral Water', brand: 'Bisleri', aisleKey: BV, unit: L, unitValue: 1, mrp: 2000, price: 2000 },
  { name: 'Paper Boat Aam Panna', brand: 'Paper Boat', aisleKey: BV, unit: ML, unitValue: 250, mrp: 3500, price: 3000 },
  { name: 'Thums Up', brand: 'Thums Up', aisleKey: BV, unit: L, unitValue: 2, mrp: 10500, price: 9500 },
  { name: 'Amul Kool Badam', brand: 'Amul', aisleKey: BV, unit: ML, unitValue: 200, mrp: 2500, price: 2500 },
  { name: 'Red Label Tea', brand: 'Brooke Bond', aisleKey: BV, unit: KG, unitValue: 1, mrp: 56000, price: 52000 },
  { name: 'Tender Coconut Water', brand: null, aisleKey: BV, unit: ML, unitValue: 200, mrp: 4900, price: 4500 },

  // ── Snacks ──────────────────────────────────────────────────────────
  { name: 'Aloo Bhujia', brand: "Haldiram's", aisleKey: S, unit: G, unitValue: 400, mrp: 12000, price: 11000 },
  { name: 'Lays Classic Salted', brand: 'Lays', aisleKey: S, unit: G, unitValue: 52, mrp: 2000, price: 2000 },
  { name: 'Parle-G Biscuits', brand: 'Parle', aisleKey: S, unit: G, unitValue: 800, mrp: 9000, price: 8500 },
  { name: 'Kurkure Masala Munch', brand: 'Kurkure', aisleKey: S, unit: G, unitValue: 90, mrp: 2000, price: 2000 },
  { name: 'Soan Papdi', brand: 'Bikano', aisleKey: S, unit: G, unitValue: 500, mrp: 17000, price: 15500 },
  { name: 'Good Day Cashew', brand: 'Britannia', aisleKey: S, unit: G, unitValue: 600, mrp: 12500, price: 11500 },
  { name: 'Murukku Mixture', brand: null, aisleKey: S, unit: G, unitValue: 250, mrp: 8500, price: 7500 },
  { name: 'Roasted Peanuts', brand: null, aisleKey: S, unit: G, unitValue: 500, mrp: 10500, price: 9500 },
  { name: 'Dark Fantasy Choco Fills', brand: 'Sunfeast', aisleKey: S, unit: G, unitValue: 300, mrp: 13500, price: 12500 },
  { name: 'Kerala Banana Chips', brand: null, aisleKey: S, unit: G, unitValue: 250, mrp: 9500, price: 8500 },

  // ── Staples & Grains ────────────────────────────────────────────────
  { name: 'Sona Masoori Rice', brand: null, aisleKey: ST, unit: KG, unitValue: 5, mrp: 46000, price: 42000 },
  { name: 'Toor Dal', brand: null, aisleKey: ST, unit: KG, unitValue: 1, mrp: 18500, price: 16900 },
  { name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad', aisleKey: ST, unit: KG, unitValue: 5, mrp: 29000, price: 26500 },
  { name: 'Fortune Sunflower Oil', brand: 'Fortune', aisleKey: ST, unit: L, unitValue: 1, mrp: 15500, price: 14500 },
  { name: 'Sugar Crystal', brand: null, aisleKey: ST, unit: KG, unitValue: 1, mrp: 5200, price: 4800 },
  { name: 'Tata Salt', brand: 'Tata', aisleKey: ST, unit: KG, unitValue: 1, mrp: 2800, price: 2800 },
  { name: 'Basmati Rice Premium', brand: 'India Gate', aisleKey: ST, unit: KG, unitValue: 1, mrp: 17500, price: 15900 },
  { name: 'Moong Dal', brand: null, aisleKey: ST, unit: KG, unitValue: 1, mrp: 15900, price: 14500 },
  { name: 'Chana Dal', brand: null, aisleKey: ST, unit: KG, unitValue: 1, mrp: 12500, price: 11500 },
  { name: 'Besan Gram Flour', brand: null, aisleKey: ST, unit: G, unitValue: 500, mrp: 7200, price: 6500 },

  // ── Frozen ──────────────────────────────────────────────────────────
  { name: 'McCain French Fries', brand: 'McCain', aisleKey: FZ, unit: G, unitValue: 750, mrp: 18000, price: 16500 },
  { name: 'Frozen Green Peas', brand: 'Safal', aisleKey: FZ, unit: G, unitValue: 500, mrp: 10500, price: 9500 },
  { name: 'Chicken Nuggets', brand: 'ITC Master Chef', aisleKey: FZ, unit: G, unitValue: 500, mrp: 27500, price: 25500 },
  { name: 'Vanilla Ice Cream Tub', brand: 'Vadilal', aisleKey: FZ, unit: L, unitValue: 1, mrp: 26500, price: 24500 },
  { name: 'Frozen Malabar Paratha', brand: null, aisleKey: FZ, unit: PK, unitValue: 5, mrp: 12500, price: 11500 },
  { name: 'Frozen Sweet Corn', brand: 'Safal', aisleKey: FZ, unit: G, unitValue: 500, mrp: 9500, price: 8500 },
  { name: 'Veg Spring Roll', brand: 'McCain', aisleKey: FZ, unit: G, unitValue: 350, mrp: 19000, price: 17500 },
  { name: 'Frozen Idli', brand: 'iD Fresh', aisleKey: FZ, unit: PC, unitValue: 20, mrp: 15900, price: 14500 },
  { name: 'Cornetto Butterscotch', brand: 'Kwality Walls', aisleKey: FZ, unit: ML, unitValue: 110, mrp: 5000, price: 4500 },
  { name: 'Frozen Mixed Vegetables', brand: 'Safal', aisleKey: FZ, unit: KG, unitValue: 1, mrp: 16900, price: 15500 },
  // ── Home & Electronics ──────────────────────────────────────────────
  // What a kirana or a 20-minute delivery store actually keeps on the
  // shelf: the small things you replace, not the things you research.
  { name: 'LED Bulb 9W Cool White', brand: 'Philips', aisleKey: EL, unit: PC, unitValue: 1, mrp: 19900, price: 14900 },
  { name: 'Extension Board 4 Socket', brand: 'Anchor', aisleKey: EL, unit: PC, unitValue: 1, mrp: 44900, price: 36900 },
  { name: 'AA Alkaline Battery 4 Pack', brand: 'Duracell', aisleKey: EL, unit: PK, unitValue: 4, mrp: 22900, price: 18900 },
  { name: 'USB-C Charging Cable 1m', brand: 'boAt', aisleKey: EL, unit: PC, unitValue: 1, mrp: 39900, price: 24900 },
  { name: 'Electric Kettle 1.5L', brand: 'Prestige', aisleKey: EL, unit: PC, unitValue: 1, mrp: 149900, price: 109900 },
  { name: 'Mixer Grinder 500W', brand: 'Bajaj', aisleKey: EL, unit: PC, unitValue: 1, mrp: 349900, price: 269900 },
  { name: 'Immersion Rod 1500W', brand: 'Havells', aisleKey: EL, unit: PC, unitValue: 1, mrp: 89900, price: 69900 },
  { name: 'Mosquito Repellent Machine', brand: 'Good Knight', aisleKey: EL, unit: PC, unitValue: 1, mrp: 9900, price: 7900 },
  { name: 'Table Fan 400mm', brand: 'Usha', aisleKey: EL, unit: PC, unitValue: 1, mrp: 249900, price: 189900 },
  { name: 'Wall Clock Silent Sweep', brand: 'Ajanta', aisleKey: EL, unit: PC, unitValue: 1, mrp: 64900, price: 44900 },
];

/** 40 customers. */
export const DEMO_CUSTOMER_NAMES: readonly string[] = [
  'Aarav Menon', 'Diya Krishnan', 'Rohan Bhat', 'Ishita Rao', 'Karthik Subramanian',
  'Sneha Kulkarni', 'Vivek Nair', 'Ananya Reddy', 'Aditya Joshi', 'Meera Pillai',
  'Nikhil Shetty', 'Tara Sinha', 'Arjun Desai', 'Kavya Hegde', 'Rahul Varma',
  'Pooja Agarwal', 'Siddharth Rane', 'Nandini Murthy', 'Harsh Patel', 'Riya Chauhan',
  'Manish Bhardwaj', 'Divya Ramesh', 'Akash Pawar', 'Shruti Kamat', 'Varun Mehta',
  'Lakshmi Sundaram', 'Imran Qureshi', 'Neha Bansal', 'Gaurav Thakur', 'Priya Balan',
  'Sanjay Kaul', 'Aisha Fernandes', 'Rakesh Yadav', 'Swathi Acharya', 'Deepak Malhotra',
  'Fatima Ansari', 'Prateek Saxena', 'Bhavya Jain', 'Tanmay Ghosh', 'Ritika Chandra',
];

/** 12 delivery partners. */
export const DEMO_RIDER_NAMES: readonly string[] = [
  'Mohan Kumar', 'Imtiaz Khan', 'Sandeep Rathore', 'Prakash Naik', 'Ajay Tiwari',
  'Firoz Alam', 'Ravi Shankar', 'Santosh Mane', 'Dinesh Pujari', 'Naveen Dsouza',
  'Kamal Singh', 'Yusuf Merchant',
];

export const DEMO_VEHICLES: readonly VehicleType[] = [
  VehicleType.SCOOTER,
  VehicleType.MOTORCYCLE,
  VehicleType.EV_SCOOTER,
  VehicleType.BICYCLE,
];

export interface DemoLocalitySpec {
  city: string;
  pincode: string;
  line1: string;
  lng: number;
  lat: number;
}

/** Delivery addresses, clustered around the vendor coordinates. */
export const DEMO_LOCALITIES: readonly DemoLocalitySpec[] = [
  { city: 'Bengaluru', pincode: '560041', line1: '204, Sobha Lakeview, Jayanagar 7th Block', lng: 77.5851, lat: 12.9215 },
  { city: 'Bengaluru', pincode: '560038', line1: 'B-12, Defence Colony, Indiranagar', lng: 77.6389, lat: 12.9719 },
  { city: 'Bengaluru', pincode: '560034', line1: '3rd Floor, 5th Block, Koramangala', lng: 77.6198, lat: 12.9345 },
  { city: 'Bengaluru', pincode: '560004', line1: '18, DVG Road, Basavanagudi', lng: 77.5742, lat: 12.9438 },
  { city: 'Bengaluru', pincode: '560102', line1: '901, Sector 1, HSR Layout', lng: 77.6412, lat: 12.9105 },
  { city: 'Mumbai', pincode: '400053', line1: '702, Veera Desai Road, Andheri West', lng: 72.8351, lat: 19.1341 },
  { city: 'Mumbai', pincode: '400028', line1: '5A, Shivaji Park, Dadar West', lng: 72.8397, lat: 19.0283 },
  { city: 'Mumbai', pincode: '400050', line1: '11, Pali Naka, Bandra West', lng: 72.8261, lat: 19.0663 },
];

export interface DemoCouponSpec {
  code: string;
  type: 'flat' | 'percent';
  /** FLAT: INTEGER PAISE. PERCENT: whole percent. */
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  usageLimit: number;
  usedCount: number;
  perUserLimit: number;
  /** Days relative to "now": negative is in the past. */
  fromOffsetDays: number;
  toOffsetDays: number;
  isActive: boolean;
  description: string;
  /** Index into DEMO_VENDORS, or null for a platform-wide coupon. */
  vendorIndex: number | null;
}

export const DEMO_COUPONS: readonly DemoCouponSpec[] = [
  {
    code: 'MANDI100', type: 'flat', value: 10000, minOrder: 49900, maxDiscount: null,
    usageLimit: 1000, usedCount: 214, perUserLimit: 2,
    fromOffsetDays: -60, toOffsetDays: 30, isActive: true,
    description: 'Rs 100 off on orders above Rs 499', vendorIndex: null,
  },
  {
    code: 'FRESH20', type: 'percent', value: 20, minOrder: 29900, maxDiscount: 15000,
    usageLimit: 500, usedCount: 88, perUserLimit: 1,
    fromOffsetDays: -30, toOffsetDays: 15, isActive: true,
    description: '20% off fruit and vegetables, capped at Rs 150', vendorIndex: 1,
  },
  {
    code: 'WELCOME50', type: 'flat', value: 5000, minOrder: 19900, maxDiscount: null,
    usageLimit: 0, usedCount: 402, perUserLimit: 1,
    fromOffsetDays: -90, toOffsetDays: 90, isActive: true,
    description: 'Rs 50 off your first Mandi order', vendorIndex: null,
  },
  {
    code: 'WEEKEND15', type: 'percent', value: 15, minOrder: 39900, maxDiscount: 10000,
    usageLimit: 800, usedCount: 133, perUserLimit: 4,
    fromOffsetDays: -20, toOffsetDays: 20, isActive: true,
    description: '15% off every weekend, capped at Rs 100', vendorIndex: null,
  },
  {
    code: 'DAIRY25', type: 'percent', value: 25, minOrder: 19900, maxDiscount: 7500,
    usageLimit: 300, usedCount: 51, perUserLimit: 2,
    fromOffsetDays: -10, toOffsetDays: 25, isActive: true,
    description: '25% off at Nandini Dairy Point, capped at Rs 75', vendorIndex: 2,
  },
  {
    code: 'MONSOON99', type: 'flat', value: 9900, minOrder: 99900, maxDiscount: null,
    usageLimit: 200, usedCount: 200, perUserLimit: 1,
    fromOffsetDays: -75, toOffsetDays: -15, isActive: false,
    description: 'Expired monsoon offer, retained for reporting', vendorIndex: null,
  },
];
