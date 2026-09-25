import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  Product,
  ProductDocument,
} from '../../../database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import { Cart, CartDocument, CartStatus } from '../schemas/cart.schema';
import { GST_PCT, computePricing } from '../pricing/pricing';
import { ShopSettingsService } from '../common/shop-settings.service';
import { problem } from '../common/problem';
import { AddCartItemDto, MAX_QTY_PER_LINE } from './dto';

/** Why a line cannot be checked out as-is. Never auto-corrected. */
export type CartLineFlag =
  | 'price_changed'
  | 'out_of_stock'
  | 'reduced_qty'
  | 'unavailable';

export interface CartLine {
  productId: string;
  name: string;
  image: string | null;
  /** INTEGER PAISE — the price when the line was added. */
  price: number;
  /** INTEGER PAISE — the price right now. */
  currentPrice: number;
  qty: number;
  /** currentPrice × qty, INTEGER PAISE. */
  lineTotal: number;
  /** Live stock. `qty` above this is a `reduced_qty` flag, not a fix. */
  availableQty: number;
  flags: CartLineFlag[];
}

export interface CartPricing {
  itemsSubtotal: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
}

export interface ParkedCartSummary {
  id: string;
  vendorId: string;
  storeName: string;
  itemCount: number;
  updatedAt: string;
}

export interface CartView {
  /** Null when the customer has no cart at all yet. */
  id: string | null;
  vendorId: string | null;
  store: {
    id: string;
    slug: string;
    storeName: string;
    isOpen: boolean;
  } | null;
  status: CartStatus | null;
  items: CartLine[];
  itemCount: number;
  pricing: CartPricing;
  /** True when any line carries a flag. Blocks a clean checkout. */
  hasIssues: boolean;
  /** Other stores' baskets, set aside and restorable for 7 days. */
  parkedCarts: ParkedCartSummary[];
}

export interface AddItemResult {
  cart: CartView;
  /**
   * The basket that was set aside because this item came from a
   * different store. Null when nothing was parked.
   */
  parked: ParkedCartSummary | null;
}

interface VendorLean {
  _id: Types.ObjectId;
  slug: string;
  storeName: string;
  isOpen: boolean;
  commissionPct: number;
  status: VendorStatus;
}

interface ProductLean {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  name: string;
  images: string[];
  price: number;
  isActive: boolean;
}

const MAX_LINES = 50;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE CART
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two behaviours in here are the difference between a cart that works and
 * one that loses orders.
 *
 * ── 1. Switching store PARKS, it does not destroy (decision #1) ─────────
 * One vendor per cart is a hard constraint — one order is one pickup and
 * one rider. But the naive implementation of that constraint ("your cart
 * will be cleared, OK?") throws away work the customer did. Here the old
 * basket is moved to `parked`, stays restorable for seven days, and is
 * listed on every cart response so the UI can offer it back.
 *
 * ── 2. A stale cart is SURFACED, never silently repaired ────────────────
 * Prices move and stock runs out between adding an item and paying for
 * it. `GET /cart` re-reads every line against the live product and
 * inventory and returns per-line flags. It does NOT rewrite the snapshot:
 * a basket that quietly re-prices itself charges a customer a number they
 * were never shown, and a basket that quietly drops a line delivers an
 * order that is missing something. Both are worse than an honest warning.
 */
@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    private readonly settings: ShopSettingsService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────

  async view(customerId: string, vendorId?: string): Promise<CartView> {
    const owner = new Types.ObjectId(customerId);

    const cart = vendorId
      ? await this.carts
          .findOne({
            customerId: owner,
            vendorId: new Types.ObjectId(vendorId),
            status: { $in: [CartStatus.ACTIVE, CartStatus.PARKED] },
          })
          .exec()
      : await this.activeCart(owner);

    return this.render(owner, cart);
  }

  // ── Writes ────────────────────────────────────────────────────────────

  /**
   * Add to the basket, parking another store's basket if there is one.
   *
   * The stock check here is advisory ONLY. It exists to tell the customer
   * "there are three left" while they are shopping; it is NOT what stops
   * an oversell. That is the atomic conditional decrement at checkout
   * (§8.2), because anything checked here can be gone milliseconds later.
   */
  async addItem(customerId: string, dto: AddCartItemDto): Promise<AddItemResult> {
    const owner = new Types.ObjectId(customerId);
    const vendorId = new Types.ObjectId(dto.vendorId);
    const qty = dto.qty ?? 1;

    const vendor = await this.vendors
      .findOne({ _id: vendorId, status: VendorStatus.APPROVED })
      .lean<VendorLean | null>()
      .exec();
    if (!vendor) throw new NotFoundException('Store not found');

    const product = await this.products
      .findOne({ _id: new Types.ObjectId(dto.productId), isActive: true })
      .lean<ProductLean | null>()
      .exec();
    if (!product) throw new NotFoundException('Product not found');

    // A product id from another store is a client bug or a probe. Either
    // way it is a 404: confirming that the id exists somewhere else on
    // the platform tells the caller something they did not have.
    if (!product.vendorId.equals(vendorId)) {
      throw new NotFoundException('Product not found');
    }

    const active = await this.activeCart(owner);
    let parked: ParkedCartSummary | null = null;

    if (active && !active.vendorId.equals(vendorId)) {
      parked = await this.parkCart(active);
    }

    const cart =
      active && active.vendorId.equals(vendorId)
        ? active
        : await this.resumeOrCreate(owner, vendorId);

    const existing = cart.items.find((item) =>
      item.productId.equals(product._id),
    );
    const nextQty = (existing?.qty ?? 0) + qty;

    if (nextQty > MAX_QTY_PER_LINE) {
      throw new BadRequestException(
        `At most ${MAX_QTY_PER_LINE} of one product per order`,
      );
    }
    if (!existing && cart.items.length >= MAX_LINES) {
      throw new BadRequestException(
        `A cart holds at most ${MAX_LINES} different products`,
      );
    }

    const available = await this.stockOf(product._id);
    if (available < nextQty) {
      throw new ConflictException(
        problem(
          'INSUFFICIENT_STOCK',
          available === 0
            ? 'This product is out of stock'
            : `Only ${available} left`,
          { productId: product._id.toString(), availableQty: available },
        ),
      );
    }

    if (existing) {
      existing.qty = nextQty;
      // Refresh the snapshot on an explicit add: the customer is looking
      // at the current price at this exact moment, so that is the number
      // they consented to.
      existing.price = product.price;
      existing.name = product.name;
      existing.image = product.images[0] ?? null;
    } else {
      cart.items.push({
        productId: product._id,
        name: product.name,
        image: product.images[0] ?? null,
        price: product.price,
        qty: nextQty,
      });
    }

    await cart.save();

    return { cart: await this.render(owner, cart), parked };
  }

  /** Absolute set. `qty` of 0 is not allowed — use DELETE. */
  async updateItem(
    customerId: string,
    productId: string,
    qty: number,
  ): Promise<CartView> {
    const owner = new Types.ObjectId(customerId);
    const cart = await this.activeCart(owner);
    if (!cart) throw new NotFoundException('No active cart');

    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('That product is not in your cart');
    }
    const target = new Types.ObjectId(productId);
    const line = cart.items.find((item) => item.productId.equals(target));
    if (!line) throw new NotFoundException('That product is not in your cart');

    const available = await this.stockOf(target);
    if (available < qty) {
      throw new ConflictException(
        problem(
          'INSUFFICIENT_STOCK',
          available === 0
            ? 'This product is out of stock'
            : `Only ${available} left`,
          { productId, availableQty: available },
        ),
      );
    }

    line.qty = qty;
    await cart.save();

    return this.render(owner, cart);
  }

  async removeItem(customerId: string, productId: string): Promise<CartView> {
    const owner = new Types.ObjectId(customerId);
    const cart = await this.activeCart(owner);
    if (!cart) throw new NotFoundException('No active cart');

    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('That product is not in your cart');
    }
    const target = new Types.ObjectId(productId);
    const before = cart.items.length;
    cart.items = cart.items.filter((item) => !item.productId.equals(target));

    if (cart.items.length === before) {
      throw new NotFoundException('That product is not in your cart');
    }

    await cart.save();
    return this.render(owner, cart);
  }

  /**
   * Empties the active cart.
   *
   * The DOCUMENT is deleted rather than emptied: an empty active cart
   * would keep holding the unique (customer, vendor) slot and is
   * indistinguishable, to every reader, from no cart at all.
   */
  async clear(customerId: string): Promise<CartView> {
    const owner = new Types.ObjectId(customerId);
    const cart = await this.activeCart(owner);
    if (cart) await this.carts.deleteOne({ _id: cart._id }).exec();
    return this.render(owner, null);
  }

  /**
   * Explicitly set the basket aside — "I want to look at another store".
   *
   * The same thing `addItem` does implicitly, exposed so the UI can offer
   * it as a deliberate choice rather than a side effect.
   */
  async park(
    customerId: string,
    vendorId?: string,
  ): Promise<{ parked: ParkedCartSummary | null; cart: CartView }> {
    const owner = new Types.ObjectId(customerId);
    const cart = await this.activeCart(owner);
    if (!cart) throw new NotFoundException('No active cart to park');

    if (vendorId && !cart.vendorId.equals(new Types.ObjectId(vendorId))) {
      throw new ConflictException(
        problem(
          'CART_CHANGED',
          'The active cart belongs to a different store than the client expected',
          { activeVendorId: cart.vendorId.toString() },
        ),
      );
    }

    const parked = await this.parkCart(cart);
    return { parked, cart: await this.render(owner, null) };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private activeCart(owner: Types.ObjectId): Promise<CartDocument | null> {
    return this.carts
      .findOne({ customerId: owner, status: CartStatus.ACTIVE })
      .exec();
  }

  private async parkCart(cart: CartDocument): Promise<ParkedCartSummary> {
    cart.status = CartStatus.PARKED;
    await cart.save();

    const vendor = await this.vendors
      .findById(cart.vendorId)
      .lean<VendorLean | null>()
      .exec();

    return {
      id: cart._id.toString(),
      vendorId: cart.vendorId.toString(),
      storeName: vendor?.storeName ?? 'Store',
      itemCount: cart.items.reduce((sum, item) => sum + item.qty, 0),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  /**
   * Restores this store's parked basket if there is one, else starts a
   * new basket. Restoring is the whole point of parking.
   */
  private async resumeOrCreate(
    owner: Types.ObjectId,
    vendorId: Types.ObjectId,
  ): Promise<CartDocument> {
    const parked = await this.carts
      .findOne({
        customerId: owner,
        vendorId,
        status: CartStatus.PARKED,
      })
      .exec();

    if (parked) {
      parked.status = CartStatus.ACTIVE;
      await parked.save();
      return parked;
    }

    return this.carts.create({
      customerId: owner,
      vendorId,
      items: [],
      status: CartStatus.ACTIVE,
    });
  }

  private async stockOf(productId: Types.ObjectId): Promise<number> {
    const row = await this.inventory
      .findOne({ productId })
      .select('stock')
      .lean<{ stock: number } | null>()
      .exec();

    return row?.stock ?? 0;
  }

  /**
   * Re-reads every line against the live catalogue and inventory.
   *
   * One query for the products, one for the stock — not one per line.
   */
  async revalidate(
    cart: CartDocument,
    session?: ClientSession,
  ): Promise<CartLine[]> {
    if (cart.items.length === 0) return [];

    const ids = cart.items.map((item) => item.productId);

    const [products, stock] = await Promise.all([
      this.products
        .find({ _id: { $in: ids } })
        .select('name images price isActive vendorId')
        .session(session ?? null)
        .lean<ProductLean[]>()
        .exec(),
      this.inventory
        .find({ productId: { $in: ids } })
        .select('productId stock')
        .session(session ?? null)
        .lean<{ productId: Types.ObjectId; stock: number }[]>()
        .exec(),
    ]);

    const productById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const stockByProduct = new Map(
      stock.map((row) => [row.productId.toString(), row.stock]),
    );

    return cart.items.map((item) => {
      const key = item.productId.toString();
      const product = productById.get(key);
      const available = stockByProduct.get(key) ?? 0;
      const flags: CartLineFlag[] = [];

      // Delisted or withdrawn: there is no live price to charge.
      if (!product || !product.isActive) {
        return {
          productId: key,
          name: item.name,
          image: item.image ?? null,
          price: item.price,
          currentPrice: item.price,
          qty: item.qty,
          lineTotal: item.price * item.qty,
          availableQty: 0,
          flags: ['unavailable', 'out_of_stock'],
        };
      }

      if (product.price !== item.price) flags.push('price_changed');
      if (available <= 0) flags.push('out_of_stock');
      else if (available < item.qty) flags.push('reduced_qty');

      return {
        productId: key,
        name: product.name,
        image: product.images[0] ?? item.image ?? null,
        price: item.price,
        currentPrice: product.price,
        qty: item.qty,
        lineTotal: product.price * item.qty,
        availableQty: available,
        flags,
      };
    });
  }

  /** Builds the response, including the parked-cart list. */
  private async render(
    owner: Types.ObjectId,
    cart: CartDocument | null,
  ): Promise<CartView> {
    const [parkedCarts, settings] = await Promise.all([
      this.listParked(owner, cart?._id),
      this.settings.read(),
    ]);

    if (!cart) {
      return {
        id: null,
        vendorId: null,
        store: null,
        status: null,
        items: [],
        itemCount: 0,
        pricing: {
          itemsSubtotal: 0,
          deliveryFee: 0,
          taxes: 0,
          grandTotal: 0,
        },
        hasIssues: false,
        parkedCarts,
      };
    }

    const [lines, vendor] = await Promise.all([
      this.revalidate(cart),
      this.vendors.findById(cart.vendorId).lean<VendorLean | null>().exec(),
    ]);

    // Priced from the LIVE price, so the total on screen is the total the
    // checkout will charge. The snapshot is still reported per line, and
    // flagged, so the customer can see what moved.
    const pricing = computePricing({
      lines: lines
        .filter((line) => !line.flags.includes('unavailable'))
        .map((line) => ({ price: line.currentPrice, qty: line.qty })),
      coupon: null,
      deliveryFeePaise: settings.deliveryFeePaise,
      freeDeliveryThresholdPaise: settings.freeDeliveryThresholdPaise,
      gstPct: GST_PCT,
      commissionPct: vendor?.commissionPct ?? 0,
    });

    return {
      id: cart._id.toString(),
      vendorId: cart.vendorId.toString(),
      store: vendor
        ? {
            id: vendor._id.toString(),
            slug: vendor.slug,
            storeName: vendor.storeName,
            isOpen: vendor.isOpen,
          }
        : null,
      status: cart.status,
      items: lines,
      itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
      pricing: {
        itemsSubtotal: pricing.itemsSubtotal,
        deliveryFee: pricing.deliveryFee,
        taxes: pricing.taxes,
        grandTotal: pricing.grandTotal,
      },
      hasIssues: lines.some((line) => line.flags.length > 0),
      parkedCarts,
    };
  }

  private async listParked(
    owner: Types.ObjectId,
    exclude?: Types.ObjectId,
  ): Promise<ParkedCartSummary[]> {
    const parked = await this.carts
      .find({ customerId: owner, status: CartStatus.PARKED })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean<
        {
          _id: Types.ObjectId;
          vendorId: Types.ObjectId;
          items: { qty: number }[];
          updatedAt: Date;
        }[]
      >()
      .exec();

    const rows = parked.filter((row) => !exclude || !row._id.equals(exclude));
    if (rows.length === 0) return [];

    const vendors = await this.vendors
      .find({ _id: { $in: rows.map((row) => row.vendorId) } })
      .select('storeName')
      .lean<{ _id: Types.ObjectId; storeName: string }[]>()
      .exec();

    const nameById = new Map(
      vendors.map((vendor) => [vendor._id.toString(), vendor.storeName]),
    );

    return rows.map((row) => ({
      id: row._id.toString(),
      vendorId: row.vendorId.toString(),
      storeName: nameById.get(row.vendorId.toString()) ?? 'Store',
      itemCount: row.items.reduce((sum, item) => sum + item.qty, 0),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
