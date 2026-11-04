import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  Product,
  ProductDocument,
} from '../../../database/schemas/product.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  Category,
  CategoryDocument,
} from '../../../database/schemas/category.schema';
import {
  WishlistItem,
  WishlistItemDocument,
} from '../schemas/wishlist-item.schema';
import { aisleByCategory, stockByProduct } from '../common/catalog-read';
import { problem } from '../common/problem';
import {
  ProductLean,
  ProductRow,
  toProductRow,
} from '../discovery/discovery.service';

/**
 * The ceiling on one customer's wishlist.
 *
 * `GET /wishlist` returns the whole list in one response (the web app
 * needs every saved id to draw the hearts on a catalogue page), so the
 * list has to have an end. Two hundred is far past any real shopping list
 * and well short of a payload worth worrying about.
 */
export const MAX_WISHLIST_ITEMS = 200;

/** Why a saved product cannot go in a basket right now. */
export type WishlistUnavailableReason =
  /** The product document is gone. Only the snapshot remains. */
  | 'deleted'
  /** The store or an admin withdrew it from sale. */
  | 'inactive'
  /** The store is suspended, pending, or gone. */
  | 'store_unavailable';

/** `GET /wishlist` → `WishlistRow[]`. */
export interface WishlistRow {
  productId: string;
  addedAt: string;
  /** False when `unavailableReason` is set. Out of stock is NOT unavailable. */
  available: boolean;
  unavailableReason: WishlistUnavailableReason | null;
  /** The live name when the product exists, else the snapshot. */
  name: string;
  image: string | null;
  /** Live catalogue data. Null only when the product was deleted. */
  product: (ProductRow & { isActive: boolean }) | null;
  /** The store, for the basket. Null only when the vendor document is gone. */
  store: {
    id: string;
    slug: string;
    storeName: string;
    isOpen: boolean;
  } | null;
}

export interface WishlistToggleResult {
  productId: string;
  saved: boolean;
}

interface VendorLean {
  _id: Types.ObjectId;
  slug: string;
  storeName: string;
  isOpen: boolean;
  status: VendorStatus;
}

interface WishlistLean {
  productId: Types.ObjectId;
  vendorId: Types.ObjectId;
  name: string;
  image?: string | null;
  createdAt: Date;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE WISHLIST
 * ════════════════════════════════════════════════════════════════════════
 *
 * Both writes are IDEMPOTENT, because a heart is a toggle the customer
 * can tap twice, and two tabs can tap it at once:
 *
 *   POST   /wishlist/:productId   saved afterwards, however many times
 *   DELETE /wishlist/:productId   not saved afterwards, ditto — including
 *                                 when it never was
 *
 * The read is HONEST about what happened to a saved product. A row whose
 * product was withdrawn or deleted, or whose store was suspended, stays on
 * the list marked unavailable with the reason. Dropping it silently would
 * make a customer's saved item vanish without explanation, which reads as
 * the app losing their data.
 */
@Injectable()
export class WishlistService {
  constructor(
    @InjectModel(WishlistItem.name)
    private readonly items: Model<WishlistItemDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
  ) {}

  async list(customerId: string): Promise<WishlistRow[]> {
    const rows = await this.items
      .find({ customerId: new Types.ObjectId(customerId) })
      .sort({ createdAt: -1 })
      .limit(MAX_WISHLIST_ITEMS)
      .lean<WishlistLean[]>()
      .exec();

    if (rows.length === 0) return [];

    const productIds = rows.map((row) => row.productId);

    // Deliberately NOT filtered on `isActive`: a withdrawn product is
    // exactly the row this read must still be able to describe.
    const products = await this.products
      .find({ _id: { $in: productIds } })
      .lean<(ProductLean & { isActive: boolean })[]>()
      .exec();

    const productById = new Map(products.map((p) => [p._id.toString(), p]));
    const vendorIds = [
      ...new Set(
        rows.map(
          (row) =>
            productById.get(row.productId.toString())?.vendorId.toString() ??
            row.vendorId.toString(),
        ),
      ),
    ].map((id) => new Types.ObjectId(id));

    const [vendors, stock, aisles] = await Promise.all([
      this.vendors
        .find({ _id: { $in: vendorIds } })
        .select('slug storeName isOpen status')
        .lean<VendorLean[]>()
        .exec(),
      stockByProduct(this.inventory, productIds),
      aisleByCategory(
        this.categories,
        products.map((p) => p.categoryId),
      ),
    ]);

    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));

    return rows.map((row): WishlistRow => {
      const product = productById.get(row.productId.toString()) ?? null;
      const vendor =
        vendorById.get(
          (product?.vendorId ?? row.vendorId).toString(),
        ) ?? null;

      const reason: WishlistUnavailableReason | null =
        product === null
          ? 'deleted'
          : !product.isActive
            ? 'inactive'
            : vendor === null || vendor.status !== VendorStatus.APPROVED
              ? 'store_unavailable'
              : null;

      return {
        productId: row.productId.toString(),
        addedAt: row.createdAt.toISOString(),
        available: reason === null,
        unavailableReason: reason,
        name: product?.name ?? row.name,
        image: product?.images[0] ?? row.image ?? null,
        product:
          product === null
            ? null
            : {
                ...toProductRow(product, stock, aisles),
                isActive: product.isActive,
              },
        store:
          vendor === null
            ? null
            : {
                id: vendor._id.toString(),
                slug: vendor.slug,
                storeName: vendor.storeName,
                isOpen: vendor.isOpen,
              },
      };
    });
  }

  /**
   * Save a product. Idempotent: an already-saved product answers exactly
   * as the first save did, without re-checking the catalogue — the
   * customer's intent ("keep this") has not changed because the store
   * since withdrew it.
   *
   * A NEW save must name a product a customer could actually see: active,
   * from an approved store. Anything else is the same 404 the product page
   * gives, so this route is not an oracle for which ids exist.
   */
  async add(
    customerId: string,
    productId: string,
  ): Promise<WishlistToggleResult> {
    const owner = new Types.ObjectId(customerId);
    const target = this.parseId(productId);

    const existing = await this.items
      .exists({ customerId: owner, productId: target })
      .exec();
    if (existing) return { productId, saved: true };

    const product = await this.products
      .findOne({ _id: target, isActive: true })
      .select('vendorId name images')
      .lean<{
        _id: Types.ObjectId;
        vendorId: Types.ObjectId;
        name: string;
        images: string[];
      } | null>()
      .exec();
    if (!product) throw new NotFoundException('Product not found');

    const vendorOk = await this.vendors
      .exists({ _id: product.vendorId, status: VendorStatus.APPROVED })
      .exec();
    if (!vendorOk) throw new NotFoundException('Product not found');

    const count = await this.items.countDocuments({ customerId: owner }).exec();
    if (count >= MAX_WISHLIST_ITEMS) {
      throw new ConflictException(
        problem(
          'WISHLIST_FULL',
          `Your wishlist holds at most ${MAX_WISHLIST_ITEMS} items. Remove one to save another.`,
          { limit: MAX_WISHLIST_ITEMS },
        ),
      );
    }

    try {
      // `$setOnInsert` against the unique index: a concurrent save of the
      // same product resolves to the one row, never two.
      await this.items
        .updateOne(
          { customerId: owner, productId: target },
          {
            $setOnInsert: {
              customerId: owner,
              productId: target,
              vendorId: product.vendorId,
              name: product.name,
              image: product.images[0] ?? null,
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      // Two upserts racing on an empty slot: one inserts, the other hits
      // the unique index. Either way the product is saved.
      if (!isDuplicateKeyError(error)) throw error;
    }

    return { productId, saved: true };
  }

  /** Unsave. Idempotent: removing something never saved is still a 200. */
  async remove(
    customerId: string,
    productId: string,
  ): Promise<WishlistToggleResult> {
    const target = this.parseId(productId);
    await this.items
      .deleteOne({ customerId: new Types.ObjectId(customerId), productId: target })
      .exec();
    return { productId, saved: false };
  }

  private parseId(productId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Product not found');
    }
    return new Types.ObjectId(productId);
  }
}
