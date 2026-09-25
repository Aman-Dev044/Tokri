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
import { AISLE_KEYS, AisleKey } from '../../../common/constants/aisle.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { escapeRegex, toKm } from '../common/geo.util';
import { ShopSettingsService } from '../common/shop-settings.service';
import { BrowseProductsQueryDto, BrowseStoresQueryDto } from './dto';

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

interface CategoryLean {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  aisleKey: AisleKey;
  imageUrl?: string | null;
  sortOrder: number;
}

interface ProductLean {
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

    const { lat, lng } = query;

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
    };
  }
}
