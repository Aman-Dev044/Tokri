import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  Category,
  CategoryDocument,
} from '../../../database/schemas/category.schema';
import {
  Product,
  ProductDocument,
} from '../../../database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import { GeoPoint, point } from '../../../database/schemas/geo-point';
import { AISLE_KEYS, AisleKey } from '../../../common/constants/aisle.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { distanceMetres, escapeRegex, toKm } from '../common/geo.util';
import { ShopSettingsService } from '../common/shop-settings.service';
import {
  BrowseMarketProductsQueryDto,
  BrowseProductsQueryDto,
  BrowseStoresQueryDto,
} from './dto';
import {
  PincodeCentre,
  resolvePincode,
  serviceablePincodes,
} from './pincode-table';
import { problem } from '../common/problem';

// ── Response shapes ─────────────────────────────────────────────────────

export interface StoreRow {
  id: string;
  slug: string;
  storeName: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  city: string;
  location: { lat: number; lng: number };
  isOpen: boolean;
  rating: number;
  serviceRadiusKm: number;
  codEnabled: boolean;
  /** Null when the caller did not supply a position. */
  distanceKm: number | null;
}

export interface StoreDetail extends StoreRow {
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  openingHours: { day: number; open: string; close: string }[];
  /** INTEGER PAISE. */
  codMaxAmount: number;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  productCount: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  productCount: number;
}

export interface AisleGroup {
  aisleKey: AisleKey;
  categories: CategoryRow[];
  productCount: number;
}

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  images: string[];
  unit: string;
  unitValue: number;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE. */
  price: number;
  discountPct: number;
  categoryId: string;
  aisleKey: AisleKey | null;
  inStock: boolean;
  /** Live available stock, clamped for display. */
  availableQty: number;
  /**
   * Mean of the VISIBLE reviews, 0-5 to one decimal, and how many there
   * are. Both 0 when nobody has reviewed it — a client shows nothing
   * rather than "0.0 stars", which reads as a terrible product.
   */
  ratingAvg: number;
  ratingCount: number;
}

export interface ProductDetail extends ProductRow {
  description: string | null;
  sku: string;
  category: { id: string; name: string; slug: string; aisleKey: AisleKey } | null;
  store: {
    id: string;
    slug: string;
    storeName: string;
    isOpen: boolean;
    rating: number;
  };
}

/** `GET /pincodes/:pincode` — the centre this platform resolves a PIN to. */
export interface PincodeResolution {
  pincode: string;
  city: string;
  lat: number;
  lng: number;
}

/** `GET /products` — the market-wide row: a `ProductRow` plus which store it's from. */
export interface MarketProductRow extends ProductRow {
  store: {
    id: string;
    slug: string;
    storeName: string;
    /** `null` unless the caller supplied `lat`/`lng` or a `pincode`. */
    distanceKm: number | null;
  };
}

// ── Lean projections ────────────────────────────────────────────────────

interface VendorLean {
  _id: Types.ObjectId;
  slug: string;
  storeName: string;
  description?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  location: { type: 'Point'; coordinates: number[] };
  serviceRadiusKm: number;
  isOpen: boolean;
  rating: number;
  codEnabled: boolean;
  codMaxAmount: number;
  openingHours: { day: number; open: string; close: string }[];
}

type VendorNear = VendorLean & { distanceMetres: number };

/** The narrow projection `browseMarketProducts` actually needs per store. */
interface VendorMarketLean {
  _id: Types.ObjectId;
  slug: string;
  storeName: string;
  location: { type: 'Point'; coordinates: number[] };
}

interface CategoryLean {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  aisleKey: AisleKey;
  imageUrl?: string | null;
  sortOrder: number;
}

/** Exported: the wishlist and reorder reads build a `ProductRow` too. */
export interface ProductLean {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string | null;
  brand?: string | null;
  images: string[];
  unit: string;
  unitValue: number;
  sku: string;
  mrp: number;
  price: number;
  discountPct: number;
  isActive?: boolean;
  ratingAvg?: number;
  ratingCount?: number;
}

/**
 * The one `ProductLean` → `ProductRow` mapping.
 *
 * A module function rather than a private method because three readers
 * build the same row — the catalogue, the wishlist and "order again" — and
 * a second copy of this mapping is how one of them forgets `ratingAvg`.
 */
export function toProductRow(
  product: ProductLean,
  stock: Map<string, number>,
  aisleByCategory: Map<string, AisleKey>,
): ProductRow {
  const available = stock.get(product._id.toString()) ?? 0;

  return {
    id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    brand: product.brand ?? null,
    images: product.images,
    unit: product.unit,
    unitValue: product.unitValue,
    mrp: product.mrp,
    price: product.price,
    discountPct: product.discountPct,
    categoryId: product.categoryId.toString(),
    aisleKey: aisleByCategory.get(product.categoryId.toString()) ?? null,
    inStock: available > 0,
    availableQty: available,
    ratingAvg: product.ratingAvg ?? 0,
    ratingCount: product.ratingCount ?? 0,
  };
}

/** Sort keys a caller may ask for, mapped to what Mongo is actually given. */
const PRODUCT_SORTS: Readonly<Record<string, Record<string, 1 | -1>>> = {
  name: { name: 1 },
  '-name': { name: -1 },
  price: { price: 1 },
  '-price': { price: -1 },
  createdAt: { createdAt: 1 },
  '-createdAt': { createdAt: -1 },
};

/**
 * Browse — the only part of the customer API that is `@Public()`.
 *
 * Everything here is catalogue: what stores exist, what they sell and for
 * how much. None of it is personal, and requiring a login to see a price
 * is how a grocery app loses the customer before it ever has one.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    private readonly settings: ShopSettingsService,
  ) {}

  // ── Stores ────────────────────────────────────────────────────────────

  /**
   * Serviceable stores, nearest first.
   *
   * ── Why the radius is checked TWICE ─────────────────────────────────
   * `$geoNear.maxDistance` applies the CUSTOMER's radius — "show me
   * everything within 5 km". The `$expr` stage that follows applies the
   * STORE's own `serviceRadiusKm` — "…but only the ones that will actually
   * deliver to me". They are different numbers and both matter: a store
   * 4 km away that only delivers 2 km is visible on a map and useless in
   * a basket, and listing it produces a checkout that fails at the last
   * step, which is the worst possible place to discover it.
   */
  async browseStores(
    query: BrowseStoresQueryDto,
  ): Promise<Paginated<StoreRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'lat and lng must be supplied together, or not at all',
      );
    }

    const filter: FilterQuery<VendorDocument> = {
      status: VendorStatus.APPROVED,
    };

    if (query.q) {
      // The vendor collection has no text index and is small by nature
      // (one document per physical store). A literal, escaped substring
      // match is the right tool here — the §8.7 ban on regex scans is
      // about the PRODUCT catalogue, which is three orders of magnitude
      // larger and does have a text index; see `browseProducts`.
      filter.storeName = { $regex: escapeRegex(query.q), $options: 'i' };
    }

    let { lat, lng } = query;

    // No GPS fix — fall back to the PIN code, if one was sent. A real
    // fix always wins: `pincode` is only consulted when lat/lng are both
    // absent (the `hasLat !== hasLng` guard above has already rejected a
    // lone coordinate).
    if (lat === undefined && lng === undefined && query.pincode) {
      const centre = this.centreForPincode(query.pincode);
      lat = centre.lat;
      lng = centre.lng;
    }

    if (lat === undefined || lng === undefined) {
      const [docs, total] = await Promise.all([
        this.vendors
          .find(filter)
          .sort({ rating: -1, storeName: 1 })
          .skip(skip)
          .limit(limit)
          .lean<VendorLean[]>()
          .exec(),
        this.vendors.countDocuments(filter).exec(),
      ]);

      return paginate(
        docs.map((doc) => this.toStoreRow(doc, null)),
        total,
        page,
        limit,
      );
    }

    const radiusKm = query.radius ?? (await this.settings.read()).serviceRadiusKm;

    const geoStage: PipelineStage.GeoNear = {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMetres',
        spherical: true,
        maxDistance: radiusKm * 1000,
        // Applied by the index, not afterwards: a $match placed later
        // would make $geoNear rank suspended stores ahead of open ones
        // and then discard them, silently shortening every page.
        query: filter,
      },
    };

    const serviceable: PipelineStage.Match = {
      $match: {
        $expr: {
          $lte: ['$distanceMetres', { $multiply: ['$serviceRadiusKm', 1000] }],
        },
      },
    };

    const [rows, counted] = await Promise.all([
      this.vendors
        .aggregate<VendorNear>([
          geoStage,
          serviceable,
          { $skip: skip },
          { $limit: limit },
        ])
        .exec(),
      this.vendors
        .aggregate<{ total: number }>([
          geoStage,
          serviceable,
          { $count: 'total' },
        ])
        .exec(),
    ]);

    return paginate(
      rows.map((row) => this.toStoreRow(row, row.distanceMetres)),
      counted[0]?.total ?? 0,
      page,
      limit,
    );
  }

  async storeBySlug(slug: string): Promise<StoreDetail> {
    const vendor = await this.vendors
      .findOne({ slug: slug.toLowerCase(), status: VendorStatus.APPROVED })
      .lean<VendorLean | null>()
      .exec();

    if (!vendor) throw new NotFoundException('Store not found');
    return this.toStoreDetail(vendor);
  }

  async storeById(id: string): Promise<StoreDetail> {
    const vendor = await this.findApprovedVendor(id);
    return this.toStoreDetail(vendor);
  }

  // ── PIN codes ─────────────────────────────────────────────────────────

  /**
   * One PIN code to the approximate centre this platform serves it from.
   *
   * ── WHY THIS IS A ROUTE AND NOT A CONSTANT IN THE WEB APP ──────────────
   * `CreateAddressDto` REQUIRES `lat`/`lng` — an address with no point is
   * an address no rider can navigate to and no serviceability check can
   * judge. The web app collects that point by dropping a pin on a Google
   * map. With Maps billing off the map renders as a placeholder, the pin
   * cannot be dropped, and a customer who denied geolocation is then
   * unable to save ANY address, which locks them out of checkout entirely
   * — on a screen that otherwise looks like it is working.
   *
   * This is the way out: the PIN code they already typed resolves to a
   * neighbourhood centre, good to about the same tolerance as the
   * imprecise GPS fix the map would have given them. It reads the SAME
   * static `pincode-table` as `GET /stores?pincode=` and `GET
   * /products?pincode=` — never a paid geocoding call (§8.7 cost
   * control), and never a second copy of the table shipped to the client,
   * which would drift the day a city is added.
   *
   * Public for the same reason the rest of this controller is: it is a
   * fact about where the platform delivers, not about who is asking. It
   * reveals nothing that `GET /stores?pincode=` does not already imply,
   * and a location fallback that demanded a login would fail exactly the
   * customer it exists to rescue.
   */
  resolvePincodeCentre(pincode: string): PincodeResolution {
    const centre = this.centreForPincode(pincode);
    return {
      pincode,
      city: centre.city,
      lat: centre.lat,
      lng: centre.lng,
    };
  }

  // ── Categories, grouped by aisle ──────────────────────────────────────

  /**
   * The store's categories, grouped into the eight chromatic aisles.
   *
   * Grouped server-side because the aisle IS the navigation in this UI
   * (§2.1) — the client should not have to know the aisle order, and two
   * clients doing it independently is how they drift apart.
   */
  async storeCategories(vendorId: string): Promise<AisleGroup[]> {
    const vendor = await this.findApprovedVendor(vendorId);

    const [categories, counts] = await Promise.all([
      this.categories
        .find({
          // A category is either the vendor's own or platform-global.
          $or: [{ vendorId: vendor._id }, { vendorId: null }],
          isActive: true,
        })
        .sort({ sortOrder: 1, name: 1 })
        .lean<CategoryLean[]>()
        .exec(),
      this.products
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { vendorId: vendor._id, isActive: true } },
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const countByCategory = new Map(
      counts.map((row) => [row._id.toString(), row.count]),
    );

    const groups = new Map<AisleKey, AisleGroup>();
    for (const key of AISLE_KEYS) {
      groups.set(key, { aisleKey: key, categories: [], productCount: 0 });
    }

    for (const category of categories) {
      const group = groups.get(category.aisleKey);
      if (!group) continue; // Unknown aisle key — no hue, so not shown.

      const productCount = countByCategory.get(category._id.toString()) ?? 0;
      // An empty category is an empty aisle tile. Hide it rather than
      // send the customer into a dead end.
      if (productCount === 0) continue;

      group.categories.push({
        id: category._id.toString(),
        name: category.name,
        slug: category.slug,
        imageUrl: category.imageUrl ?? null,
        sortOrder: category.sortOrder,
        productCount,
      });
      group.productCount += productCount;
    }

    return [...groups.values()].filter((group) => group.categories.length > 0);
  }

  // ── Products ──────────────────────────────────────────────────────────

  /**
   * The store's catalogue, filtered and paginated.
   *
   * ── Search ───────────────────────────────────────────────────────────
   * `q` goes through the `{ searchText: 'text' }` index, NOT through a
   * regex `$or` across name/brand/description. §8.7 bans that pattern
   * outright: a regex `$or` cannot use an index, so every keystroke
   * becomes a full collection scan, and the failure mode is invisible
   * until the catalogue is large enough for it to take the database down.
   *
   * TODO (documented cut-over, §8.7 #10): past roughly 50k products the
   * built-in text index stops being enough — no fuzzy matching, no
   * synonyms, no per-field weighting, and one index per collection. At
   * that point this method moves to Atlas Search (`$search`), which is a
   * change to this one query and nothing else.
   */
  async browseProducts(
    vendorId: string,
    query: BrowseProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    const vendor = await this.findApprovedVendor(vendorId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ProductDocument> = {
      vendorId: vendor._id,
      isActive: true,
    };

    const aisleByCategory = await this.aisleMap(vendor._id);

    // The aisle narrows the set of categories; an explicit category then
    // has to be a member of it. A filter that silently widened when the
    // two disagreed would show fruit inside the dairy aisle.
    const aisleCategoryIds = query.aisleKey
      ? [...aisleByCategory.entries()]
          .filter(([, aisle]) => aisle === query.aisleKey)
          .map(([id]) => new Types.ObjectId(id))
      : null;

    if (query.category) {
      const categoryId = await this.resolveCategoryId(
        vendor._id,
        query.category,
      );
      if (aisleCategoryIds && !aisleCategoryIds.some((id) => id.equals(categoryId))) {
        return paginate<ProductRow>([], 0, page, limit);
      }
      filter.categoryId = categoryId;
    } else if (aisleCategoryIds) {
      // No category at this store carries that aisle: an empty page, not
      // an unfiltered one.
      if (aisleCategoryIds.length === 0) {
        return paginate<ProductRow>([], 0, page, limit);
      }
      filter.categoryId = { $in: aisleCategoryIds };
    }

    if (query.q) filter.$text = { $search: query.q };

    const sort = this.resolveProductSort(query.sort, Boolean(query.q));

    const [docs, total] = await Promise.all([
      this.products
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<ProductLean[]>()
        .exec(),
      this.products.countDocuments(filter).exec(),
    ]);

    const stock = await this.stockFor(docs.map((doc) => doc._id));

    return paginate(
      docs.map((doc) => this.toProductRow(doc, stock, aisleByCategory)),
      total,
      page,
      limit,
    );
  }

  /**
   * `GET /products?q=&lat=&lng=&aisleKey=&page=&limit=` — market-wide
   * search and market-wide aisle browsing, across every APPROVED, OPEN
   * vendor. `browseProducts` above is store-scoped; this is its
   * platform-wide sibling.
   *
   * ── Search, never a regex scan ────────────────────────────────────────
   * `q` goes through the SAME `{ searchText: 'text' }` index as the
   * store-scoped listing — §8.7 bans a regex `$or` outright, and it would
   * be strictly worse here: this query already spans every vendor's
   * catalogue, not one store's shelf.
   *
   * ── The two query shapes, and the index each one rides ─────────────────
   * `vendorId: { $in: approvedOpenVendorIds }` is ALWAYS in the filter,
   * computed from the vendor collection's existing `{ status: 1, isOpen:
   * 1 }` index (the same one `browseStores` and `storeCategories` use) —
   * every APPROVED, OPEN vendor, nothing else, before a single product is
   * touched.
   *
   *   • With `q`: Mongo drives the scan off the `searchText` text index,
   *     evaluating `vendorId`/`categoryId` as additional filter
   *     predicates on the matched set — identical to how the store-scoped
   *     `browseProducts` already combines `$text` with other fields.
   *   • Without `q`: the query is `{ vendorId: { $in: [...] }, isActive,
   *     categoryId?: { $in: [...] } }`, which rides the compound
   *     `{ vendorId: 1, categoryId: 1, isActive: 1 }` index already on
   *     `Product` — an `$in` on a compound index's LEADING field is
   *     index-usable, exactly like the vendor-scoped filter above it.
   *
   * `aisleKey` resolves to a set of category ids first, off `Category`'s
   * existing `{ aisleKey: 1, sortOrder: 1 }` index, then narrows the
   * product filter the same way.
   */
  async browseMarketProducts(
    query: BrowseMarketProductsQueryDto,
  ): Promise<Paginated<MarketProductRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Resolved FIRST, before a single document is read: an unserviceable
    // PIN is a refusal, and a refusal that arrives after two collection
    // scans is just a slower refusal.
    const origin = this.originFor(query);

    const openVendors = await this.vendors
      .find({ status: VendorStatus.APPROVED, isOpen: true })
      .select('slug storeName location')
      .lean<VendorMarketLean[]>()
      .exec();

    if (openVendors.length === 0) {
      return paginate<MarketProductRow>([], 0, page, limit);
    }

    const vendorById = new Map(openVendors.map((v) => [v._id.toString(), v]));

    const filter: FilterQuery<ProductDocument> = {
      vendorId: { $in: openVendors.map((v) => v._id) },
      isActive: true,
    };

    if (query.aisleKey) {
      const categoriesInAisle = await this.categories
        .find({ aisleKey: query.aisleKey })
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      // No category anywhere on the platform carries that aisle: an
      // empty page, not an unfiltered one.
      if (categoriesInAisle.length === 0) {
        return paginate<MarketProductRow>([], 0, page, limit);
      }
      filter.categoryId = { $in: categoriesInAisle.map((c) => c._id) };
    }

    if (query.q) filter.$text = { $search: query.q };

    const sort: Record<string, 1 | -1> | { score: { $meta: 'textScore' } } =
      query.q ? { score: { $meta: 'textScore' } } : { createdAt: -1 };

    const [docs, total] = await Promise.all([
      this.products
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<ProductLean[]>()
        .exec(),
      this.products.countDocuments(filter).exec(),
    ]);

    const [stock, aisleByCategory] = await Promise.all([
      this.stockFor(docs.map((doc) => doc._id)),
      this.categoriesFor(docs.map((doc) => doc.categoryId)),
    ]);

    return paginate(
      docs.map((doc): MarketProductRow => {
        const vendor = vendorById.get(doc.vendorId.toString());
        return {
          ...this.toProductRow(doc, stock, aisleByCategory),
          store: {
            id: doc.vendorId.toString(),
            slug: vendor?.slug ?? '',
            storeName: vendor?.storeName ?? '',
            distanceKm:
              origin && vendor
                ? toKm(distanceMetres(origin, vendor.location))
                : null,
          },
        };
      }),
      total,
      page,
      limit,
    );
  }

  async productById(id: string): Promise<ProductDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Product not found');
    }

    const product = await this.products
      .findOne({ _id: new Types.ObjectId(id), isActive: true })
      .lean<ProductLean | null>()
      .exec();

    if (!product) throw new NotFoundException('Product not found');

    const [vendor, category, stock] = await Promise.all([
      this.vendors
        .findOne({ _id: product.vendorId, status: VendorStatus.APPROVED })
        .lean<VendorLean | null>()
        .exec(),
      this.categories
        .findById(product.categoryId)
        .lean<CategoryLean | null>()
        .exec(),
      this.stockFor([product._id]),
    ]);

    // The product belongs to a store that is not approved (or was
    // suspended): from the outside it simply does not exist.
    if (!vendor) throw new NotFoundException('Product not found');

    const aisleByCategory = new Map<string, AisleKey>();
    if (category) {
      aisleByCategory.set(category._id.toString(), category.aisleKey);
    }

    return {
      ...this.toProductRow(product, stock, aisleByCategory),
      description: product.description ?? null,
      sku: product.sku,
      category: category
        ? {
            id: category._id.toString(),
            name: category.name,
            slug: category.slug,
            aisleKey: category.aisleKey,
          }
        : null,
      store: {
        id: vendor._id.toString(),
        slug: vendor.slug,
        storeName: vendor.storeName,
        isOpen: vendor.isOpen,
        rating: vendor.rating,
      },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * A PIN code to a centre, or a refusal that TELLS THE CALLER WHAT WORKS.
   *
   * The old message said only "unrecognised pincode", which leaves the
   * customer typing PINs at random to find one this platform serves.
   * `problem()` keeps a stable `code` for the client and carries the
   * serviceable list, so the UI can name the cities instead of keeping a
   * second, drifting copy of `pincode-table.ts`.
   */
  private centreForPincode(pincode: string): PincodeCentre {
    const centre = resolvePincode(pincode);
    if (!centre) {
      throw new BadRequestException(
        problem(
          'PINCODE_NOT_SERVICEABLE',
          `${pincode} is not one of the PIN codes this platform serves yet.`,
          { pincode, serviceable: serviceablePincodes() },
        ),
      );
    }
    return centre;
  }

  /**
   * The point `store.distanceKm` is measured from, for DISPLAY only.
   *
   * A device fix wins outright — it is strictly more precise than a PIN
   * centre, and trusting both at once would be ambiguous about which.
   */
  private originFor(query: BrowseMarketProductsQueryDto): GeoPoint | null {
    if (query.lat !== undefined && query.lng !== undefined) {
      return point(query.lng, query.lat);
    }
    if (query.pincode) {
      const centre = this.centreForPincode(query.pincode);
      return point(centre.lng, centre.lat);
    }
    return null;
  }

  /** Approved-or-404. A suspended store is invisible, not forbidden. */
  private async findApprovedVendor(id: string): Promise<VendorLean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Store not found');
    }

    const vendor = await this.vendors
      .findOne({ _id: new Types.ObjectId(id), status: VendorStatus.APPROVED })
      .lean<VendorLean | null>()
      .exec();

    if (!vendor) throw new NotFoundException('Store not found');
    return vendor;
  }

  private async resolveCategoryId(
    vendorId: Types.ObjectId,
    value: string,
  ): Promise<Types.ObjectId> {
    if (Types.ObjectId.isValid(value)) return new Types.ObjectId(value);

    const category = await this.categories
      .findOne({
        slug: value.toLowerCase(),
        $or: [{ vendorId }, { vendorId: null }],
      })
      .lean<CategoryLean | null>()
      .exec();

    if (!category) throw new NotFoundException('Category not found');
    return category._id;
  }

  private async aisleMap(
    vendorId: Types.ObjectId,
  ): Promise<Map<string, AisleKey>> {
    const categories = await this.categories
      .find({ $or: [{ vendorId }, { vendorId: null }] })
      .select('aisleKey')
      .lean<{ _id: Types.ObjectId; aisleKey: AisleKey }[]>()
      .exec();

    return new Map(
      categories.map((category) => [
        category._id.toString(),
        category.aisleKey,
      ]),
    );
  }

  /**
   * `aisleKey` for a page of products, by their (already known)
   * category ids — the market-wide sibling of `aisleMap`, which resolves
   * an aisle map by VENDOR instead. A page of products spans many
   * vendors' own categories here, so the lookup is keyed off the
   * category ids actually present on the page rather than one vendor's
   * whole category set.
   */
  private async categoriesFor(
    categoryIds: Types.ObjectId[],
  ): Promise<Map<string, AisleKey>> {
    if (categoryIds.length === 0) return new Map();

    const unique = [...new Set(categoryIds.map((id) => id.toString()))].map(
      (id) => new Types.ObjectId(id),
    );

    const categories = await this.categories
      .find({ _id: { $in: unique } })
      .select('aisleKey')
      .lean<{ _id: Types.ObjectId; aisleKey: AisleKey }[]>()
      .exec();

    return new Map(
      categories.map((category) => [category._id.toString(), category.aisleKey]),
    );
  }

  /**
   * Stock for a page of products, in ONE query.
   *
   * Per-row lookups would be N+1 against `inventory` on every catalogue
   * page — the classic way a list endpoint that works in development
   * falls over with a real catalogue behind it.
   */
  private async stockFor(
    productIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();

    const rows = await this.inventory
      .find({ productId: { $in: productIds } })
      .select('productId stock')
      .lean<{ productId: Types.ObjectId; stock: number }[]>()
      .exec();

    return new Map(rows.map((row) => [row.productId.toString(), row.stock]));
  }

  /**
   * A sort key is attacker-controlled input.
   *
   * It is matched against an explicit allowlist, never handed to Mongoose
   * verbatim: an arbitrary key leaks index structure and lets a caller
   * order by a field they are not entitled to read.
   */
  private resolveProductSort(
    requested: string | undefined,
    hasSearch: boolean,
  ): Record<string, 1 | -1> | { score: { $meta: 'textScore' } } {
    if (requested === 'relevance' || (!requested && hasSearch)) {
      if (!hasSearch) {
        throw new BadRequestException('sort=relevance requires a `q` term');
      }
      return { score: { $meta: 'textScore' } };
    }

    if (!requested) return { name: 1 };

    const sort = PRODUCT_SORTS[requested];
    if (!sort) {
      throw new BadRequestException(
        `sort must be one of: ${Object.keys(PRODUCT_SORTS).join(', ')}, relevance`,
      );
    }
    return sort;
  }

  private toStoreRow(vendor: VendorLean, metres: number | null): StoreRow {
    const [lng, lat] = vendor.location.coordinates;
    return {
      id: vendor._id.toString(),
      slug: vendor.slug,
      storeName: vendor.storeName,
      description: vendor.description ?? null,
      logoUrl: vendor.logoUrl ?? null,
      bannerUrl: vendor.bannerUrl ?? null,
      city: vendor.address.city,
      location: { lat, lng },
      isOpen: vendor.isOpen,
      rating: vendor.rating,
      serviceRadiusKm: vendor.serviceRadiusKm,
      codEnabled: vendor.codEnabled,
      distanceKm: metres === null ? null : toKm(metres),
    };
  }

  private async toStoreDetail(vendor: VendorLean): Promise<StoreDetail> {
    const [settings, productCount] = await Promise.all([
      this.settings.read(),
      this.products
        .countDocuments({ vendorId: vendor._id, isActive: true })
        .exec(),
    ]);

    return {
      ...this.toStoreRow(vendor, null),
      address: {
        line1: vendor.address.line1,
        line2: vendor.address.line2 ?? null,
        city: vendor.address.city,
        state: vendor.address.state,
        pincode: vendor.address.pincode,
      },
      openingHours: vendor.openingHours ?? [],
      codMaxAmount: vendor.codMaxAmount,
      deliveryFee: settings.deliveryFeePaise,
      freeDeliveryThreshold: settings.freeDeliveryThresholdPaise,
      productCount,
    };
  }

  private toProductRow(
    product: ProductLean,
    stock: Map<string, number>,
    aisleByCategory: Map<string, AisleKey>,
  ): ProductRow {
    return toProductRow(product, stock, aisleByCategory);
  }
}
