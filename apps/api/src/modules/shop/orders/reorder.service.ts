import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
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
import {
  Category,
  CategoryDocument,
} from '../../../database/schemas/category.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { aisleByCategory, stockByProduct } from '../common/catalog-read';
import { problem } from '../common/problem';
import {
  ProductLean,
  ProductRow,
  toProductRow,
} from '../discovery/discovery.service';
import { MAX_QTY_PER_LINE } from '../cart/dto';
import { OrderLean } from './order-view';

/**
 * What can go back into the basket, line by line.
 *
 *   ok            — the full quantity, at today's price.
 *   reduced       — some, capped at live stock (or the per-line ceiling).
 *   out_of_stock  — still listed, none on the shelf right now.
 *   unavailable   — gone from the catalogue: deactivated, deleted, or the
 *                   store itself cannot take an order at the moment.
 */
export type ReorderLineStatus = 'ok' | 'reduced' | 'out_of_stock' | 'unavailable';

export interface ReorderLine {
  productId: string;
  /** From the order snapshot, so a vanished product still has a name. */
  name: string;
  image: string | null;
  /** How many were on the original order. */
  orderedQty: number;
  /** INTEGER PAISE — what was paid per unit then. Display only. */
  orderedPrice: number;
  /** How many can go into the basket now. 0 unless `ok` or `reduced`. */
  qty: number;
  status: ReorderLineStatus;
  /**
   * The live catalogue row — TODAY's price and stock, the only numbers
   * the basket may use. Null when the line is `unavailable`.
   */
  product: ProductRow | null;
}

export interface ReorderPreview {
  orderId: string;
  orderNo: string;
  store: {
    id: string;
    storeName: string;
    slug: string;
    /**
     * `open` — approved and taking orders. `closed` — approved, shut for
     * now. `unavailable` — no longer approved (or gone). Only `open`
     * lets anything into the basket.
     */
    availability: 'open' | 'closed' | 'unavailable';
  };
  lines: ReorderLine[];
  /** Lines with `qty > 0`. Zero means there is nothing to add. */
  addableCount: number;
}

interface VendorLean {
  _id: Types.ObjectId;
  storeName: string;
  slug: string;
  isOpen: boolean;
  status: VendorStatus;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ORDER AGAIN — a preview, never a write
 * ════════════════════════════════════════════════════════════════════════
 *
 * `GET /orders/:id/reorder-preview` re-reads every line of a DELIVERED
 * order against the catalogue as it is NOW and says what can go back in
 * the basket. It writes nothing: the client adds the lines through the
 * ordinary `POST /cart/items`, so the cart's own rules — one store per
 * basket, parking, the stock check — run exactly as they do for a tap on
 * "Add". A second, bulk path into the cart would be a second set of
 * rules to keep in step.
 *
 * ── Old prices are never trusted ─────────────────────────────────────────
 * The order's `price` is what was paid then. It is returned as
 * `orderedPrice` for display and nothing else; the basket line is built
 * from `product`, which is the live row.
 *
 * ── Ownership ────────────────────────────────────────────────────────────
 * `@Owns` on the route, and the read below filters by `customerId` again
 * — the same two independent checks as every other order read, with the
 * same 404 for another customer's order.
 */
@Injectable()
export class ReorderService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
  ) {}

  async preview(customerId: string, id: string): Promise<ReorderPreview> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }

    const order = await this.orders
      .findOne({
        _id: new Types.ObjectId(id),
        customerId: new Types.ObjectId(customerId),
      })
      .lean<OrderLean | null>()
      .exec();

    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.DELIVERED) {
      throw new ConflictException(
        problem(
          'ORDER_NOT_DELIVERED',
          'Only a delivered order can be ordered again',
          { status: order.status },
        ),
      );
    }

    const vendor = await this.vendors
      .findById(order.vendorId)
      .select('storeName slug isOpen status')
      .lean<VendorLean | null>()
      .exec();

    const availability: ReorderPreview['store']['availability'] =
      !vendor || vendor.status !== VendorStatus.APPROVED
        ? 'unavailable'
        : vendor.isOpen
          ? 'open'
          : 'closed';

    // One line per product. An order written with the same product twice
    // would otherwise ask the basket for it twice.
    const wanted = new Map<
      string,
      { name: string; image: string | null; qty: number; price: number }
    >();
    for (const item of order.items) {
      const key = item.productId.toString();
      const seen = wanted.get(key);
      if (seen) seen.qty += item.qty;
      else {
        wanted.set(key, {
          name: item.name,
          image: item.image ?? null,
          qty: item.qty,
          price: item.price,
        });
      }
    }

    const productIds = [...wanted.keys()].map((key) => new Types.ObjectId(key));

    // A closed or suspended store sells nothing, so its catalogue is not
    // read at all — every line is `unavailable` and nothing is added.
    const live =
      availability === 'open'
        ? await this.products
            .find({
              _id: { $in: productIds },
              vendorId: order.vendorId,
              isActive: true,
            })
            .lean<ProductLean[]>()
            .exec()
        : [];

    const [stock, aisles] = await Promise.all([
      stockByProduct(this.inventory, live.map((product) => product._id)),
      aisleByCategory(this.categories, live.map((product) => product.categoryId)),
    ]);
    const liveById = new Map(live.map((product) => [product._id.toString(), product]));

    const lines = [...wanted.entries()].map(([productId, line]): ReorderLine => {
      const product = liveById.get(productId);
      const base = {
        productId,
        name: line.name,
        image: line.image,
        orderedQty: line.qty,
        orderedPrice: line.price,
      };

      if (!product) {
        return { ...base, qty: 0, status: 'unavailable', product: null };
      }

      const row = toProductRow(product, stock, aisles);
      const qty = Math.max(
        0,
        Math.min(line.qty, row.availableQty, MAX_QTY_PER_LINE),
      );

      return {
        ...base,
        qty,
        status: qty === 0 ? 'out_of_stock' : qty < line.qty ? 'reduced' : 'ok',
        product: row,
      };
    });

    return {
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      store: {
        id: order.vendorId.toString(),
        storeName: vendor?.storeName ?? 'Store',
        slug: vendor?.slug ?? order.vendorId.toString(),
        availability,
      },
      lines,
      addableCount: lines.filter((line) => line.qty > 0).length,
    };
  }
}
