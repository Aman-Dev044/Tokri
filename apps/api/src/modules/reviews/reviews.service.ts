import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  ProductReview,
  ProductReviewDocument,
} from '../../database/schemas/product-review.schema';
import {
  Product,
  ProductDocument,
} from '../../database/schemas/product.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../database/schemas/vendor.schema';
import { OrderStatus } from '../../common/constants/order-status.enum';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../common/dto/paginated';
import { AuditService } from '../admin/audit/audit.service';
import { problem } from '../shop/common/problem';
import {
  AdminListReviewsQueryDto,
  CreateReviewDto,
  ListReviewsQueryDto,
  SetReviewVisibilityDto,
  UpdateReviewDto,
} from './dto';

// ── Response shapes ─────────────────────────────────────────────────────

/** One review as the public sees it. Never the customer's id or full name. */
export interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  /** "Asha K." */
  authorName: string;
  createdAt: string;
  /** Null until the author first edits it. */
  editedAt: string | null;
  /** Always true — no other kind of review can exist. Stated for the UI. */
  verifiedPurchase: true;
}

/** `GET /products/:id/reviews`. */
export interface ReviewPage extends Paginated<ReviewRow> {
  /**
   * The product's denormalised aggregate over VISIBLE reviews — the same
   * two numbers every catalogue row carries as `ratingAvg`/`ratingCount`.
   */
  summary: { average: number; count: number };
}

/** `GET /products/:id/reviews/mine`. */
export interface MyReviewState {
  /** True when the customer may write a review now (none yet, and eligible). */
  canReview: boolean;
  /**
   * Why `canReview` is false while `review` is null:
   * `NOT_PURCHASED` — no delivered order containing this product.
   */
  reason: 'NOT_PURCHASED' | null;
  /** Their own review — INCLUDING a hidden one, marked as such. */
  review: (ReviewRow & { isHidden: boolean }) | null;
}

/** `GET /admin/reviews` row. */
export interface AdminReviewRow {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  storeName: string;
  customerId: string;
  orderId: string;
  authorName: string;
  rating: number;
  comment: string | null;
  isHidden: boolean;
  hiddenReason: string | null;
  hiddenAt: string | null;
  createdAt: string;
  editedAt: string | null;
}

interface ReviewLean {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  vendorId: Types.ObjectId;
  customerId: Types.ObjectId;
  orderId: Types.ObjectId;
  rating: number;
  comment?: string | null;
  authorName: string;
  isHidden: boolean;
  hiddenReason?: string | null;
  hiddenAt?: Date | null;
  editedAt?: Date | null;
  createdAt: Date;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/** "Asha Kulkarni" → "Asha K."; "Asha" → "Asha"; "" → "A customer". */
export function publicAuthorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A customer';
  const first = parts[0] as string;
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1] as string;
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

function toReviewRow(review: ReviewLean): ReviewRow {
  return {
    id: review._id.toString(),
    rating: review.rating,
    comment: review.comment ?? null,
    authorName: review.authorName,
    createdAt: review.createdAt.toISOString(),
    editedAt: review.editedAt ? review.editedAt.toISOString() : null,
    verifiedPurchase: true,
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PRODUCT REVIEWS — verified purchase only
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Who may write one ───────────────────────────────────────────────────
 * A customer holding a DELIVERED order with a FULFILLED line for the
 * product. Not "ordered it" — a cancelled order, or a line the store
 * dropped at packing, is not a purchase the customer can speak to. One
 * review per customer per product (a unique index, not a check-then-write),
 * editable in place.
 *
 * ── The aggregate ───────────────────────────────────────────────────────
 * `Product.ratingAvg` / `ratingCount` are recomputed from the VISIBLE
 * reviews after every write that can change them: create, edit, hide,
 * unhide. A full recount rather than an increment, because a hide has to
 * subtract a rating that may have been edited twice since it was written,
 * and a recount cannot drift.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(ProductReview.name)
    private readonly reviews: Model<ProductReviewDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly audit: AuditService,
  ) {}

  // ── Public ──────────────────────────────────────────────────────────

  async listPublic(
    productId: string,
    query: ListReviewsQueryDto,
  ): Promise<ReviewPage> {
    const product = await this.visibleProduct(productId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { productId: product._id, isHidden: false };

    const [docs, total] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ReviewLean[]>()
        .exec(),
      this.reviews.countDocuments(filter).exec(),
    ]);

    return {
      ...paginate(docs.map(toReviewRow), total, page, limit),
      summary: { average: product.ratingAvg, count: product.ratingCount },
    };
  }

  // ── The customer's own ──────────────────────────────────────────────

  async mine(customerId: string, productId: string): Promise<MyReviewState> {
    const product = await this.visibleProduct(productId);
    const owner = new Types.ObjectId(customerId);

    const review = await this.reviews
      .findOne({ customerId: owner, productId: product._id })
      .lean<ReviewLean | null>()
      .exec();

    if (review) {
      return {
        canReview: false,
        reason: null,
        review: { ...toReviewRow(review), isHidden: review.isHidden },
      };
    }

    const order = await this.deliveredOrderFor(owner, product._id);
    return {
      canReview: order !== null,
      reason: order === null ? 'NOT_PURCHASED' : null,
      review: null,
    };
  }

  async create(
    customerId: string,
    productId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewRow & { isHidden: boolean }> {
    const product = await this.visibleProduct(productId);
    const owner = new Types.ObjectId(customerId);

    const order = await this.deliveredOrderFor(owner, product._id);
    if (!order) {
      throw new ForbiddenException(
        problem(
          'REVIEW_NEEDS_DELIVERED_ORDER',
          'You can review a product once an order containing it has been delivered to you.',
        ),
      );
    }

    const user = await this.users
      .findById(owner)
      .select('name')
      .lean<{ name: string } | null>()
      .exec();

    let created: ProductReviewDocument;
    try {
      created = await this.reviews.create({
        productId: product._id,
        vendorId: product.vendorId,
        customerId: owner,
        orderId: order,
        rating: dto.rating,
        comment: dto.comment ?? null,
        authorName: publicAuthorName(user?.name ?? ''),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw this.alreadyReviewed();
      throw error;
    }

    await this.recompute(product._id);
    const lean = created.toObject<ReviewLean>();
    return { ...toReviewRow(lean), isHidden: lean.isHidden };
  }

  async update(
    customerId: string,
    productId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewRow & { isHidden: boolean }> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Review not found');
    }

    const $set: Record<string, unknown> = { editedAt: new Date() };
    if (dto.rating !== undefined) $set.rating = dto.rating;
    if (dto.comment !== undefined) $set.comment = dto.comment;

    // Scoped by the token's `sub`: there is no way to name someone else's
    // review here, so there is nothing to forbid — only nothing to find.
    const updated = await this.reviews
      .findOneAndUpdate(
        {
          customerId: new Types.ObjectId(customerId),
          productId: new Types.ObjectId(productId),
        },
        { $set },
        { new: true },
      )
      .lean<ReviewLean | null>()
      .exec();

    if (!updated) throw new NotFoundException('Review not found');

    await this.recompute(updated.productId);
    return { ...toReviewRow(updated), isHidden: updated.isHidden };
  }

  // ── Admin moderation ────────────────────────────────────────────────

  async adminList(
    query: AdminListReviewsQueryDto,
  ): Promise<Paginated<AdminReviewRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<ProductReviewDocument> = {};
    if (query.status === 'visible') filter.isHidden = false;
    if (query.status === 'hidden') filter.isHidden = true;
    if (query.rating !== undefined) filter.rating = query.rating;
    if (query.productId) filter.productId = new Types.ObjectId(query.productId);

    const [docs, total] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ReviewLean[]>()
        .exec(),
      this.reviews.countDocuments(filter).exec(),
    ]);

    const [products, vendors] = await Promise.all([
      this.products
        .find({ _id: { $in: docs.map((doc) => doc.productId) } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }[]>()
        .exec(),
      this.vendors
        .find({ _id: { $in: docs.map((doc) => doc.vendorId) } })
        .select('storeName')
        .lean<{ _id: Types.ObjectId; storeName: string }[]>()
        .exec(),
    ]);
    const productName = new Map(products.map((p) => [p._id.toString(), p.name]));
    const storeName = new Map(vendors.map((v) => [v._id.toString(), v.storeName]));

    return paginate(
      docs.map((doc) => this.toAdminRow(doc, productName, storeName)),
      total,
      page,
      limit,
    );
  }

  /**
   * Hide or restore one review, with a reason, audited.
   *
   * Idempotent in effect — hiding a hidden review changes nothing but is
   * still recorded, because the operator's stated reason is the record.
   */
  async setVisibility(
    id: string,
    dto: SetReviewVisibilityDto,
    actor: JwtUser,
  ): Promise<AdminReviewRow> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Review not found');

    const before = await this.reviews
      .findById(id)
      .lean<ReviewLean | null>()
      .exec();
    if (!before) throw new NotFoundException('Review not found');

    const updated = await this.reviews
      .findByIdAndUpdate(
        before._id,
        {
          $set: dto.hidden
            ? {
                isHidden: true,
                hiddenReason: dto.reason,
                hiddenAt: new Date(),
                hiddenBy: Types.ObjectId.isValid(actor.sub)
                  ? new Types.ObjectId(actor.sub)
                  : null,
              }
            : { isHidden: false, hiddenReason: null, hiddenAt: null, hiddenBy: null },
        },
        { new: true },
      )
      .lean<ReviewLean | null>()
      .exec();
    if (!updated) throw new NotFoundException('Review not found');

    await this.recompute(updated.productId);

    await this.audit.record({
      action: dto.hidden ? 'review.hide' : 'review.unhide',
      entity: 'ProductReview',
      entityId: updated._id.toString(),
      before: { isHidden: before.isHidden, hiddenReason: before.hiddenReason ?? null },
      after: { isHidden: updated.isHidden, reason: dto.reason },
      actor,
    });

    const [product, vendor] = await Promise.all([
      this.products.findById(updated.productId).select('name').lean<{ name: string } | null>().exec(),
      this.vendors.findById(updated.vendorId).select('storeName').lean<{ storeName: string } | null>().exec(),
    ]);
    return this.toAdminRow(
      updated,
      new Map(product ? [[updated.productId.toString(), product.name]] : []),
      new Map(vendor ? [[updated.vendorId.toString(), vendor.storeName]] : []),
    );
  }

  // ── The aggregate ───────────────────────────────────────────────────

  /**
   * Rewrites `ratingAvg` / `ratingCount` on the product from its VISIBLE
   * reviews. Public so a test (or a repair script) can call it directly.
   */
  async recompute(productId: Types.ObjectId): Promise<{ average: number; count: number }> {
    const [row] = await this.reviews
      .aggregate<{ average: number; count: number }>([
        { $match: { productId, isHidden: false } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();

    const average = row ? Math.round(row.average * 10) / 10 : 0;
    const count = row?.count ?? 0;

    await this.products
      .updateOne({ _id: productId }, { $set: { ratingAvg: average, ratingCount: count } })
      .exec();

    return { average, count };
  }

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * The same visibility rule as `GET /products/:id`: an active product from
   * an approved store, or a 404. A review page for a withdrawn product is
   * a page for something that, from the outside, does not exist.
   */
  private async visibleProduct(productId: string): Promise<{
    _id: Types.ObjectId;
    vendorId: Types.ObjectId;
    ratingAvg: number;
    ratingCount: number;
  }> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Product not found');
    }

    const product = await this.products
      .findOne({ _id: new Types.ObjectId(productId), isActive: true })
      .select('vendorId ratingAvg ratingCount')
      .lean<{
        _id: Types.ObjectId;
        vendorId: Types.ObjectId;
        ratingAvg?: number;
        ratingCount?: number;
      } | null>()
      .exec();
    if (!product) throw new NotFoundException('Product not found');

    const approved = await this.vendors
      .exists({ _id: product.vendorId, status: VendorStatus.APPROVED })
      .exec();
    if (!approved) throw new NotFoundException('Product not found');

    return {
      _id: product._id,
      vendorId: product.vendorId,
      ratingAvg: product.ratingAvg ?? 0,
      ratingCount: product.ratingCount ?? 0,
    };
  }

  /** The newest delivered order with a FULFILLED line for this product. */
  private async deliveredOrderFor(
    customerId: Types.ObjectId,
    productId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const order = await this.orders
      .findOne({
        customerId,
        status: OrderStatus.DELIVERED,
        items: { $elemMatch: { productId, fulfilled: true } },
      })
      .sort({ deliveredAt: -1 })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    return order?._id ?? null;
  }

  private alreadyReviewed(): ConflictException {
    return new ConflictException(
      problem(
        'REVIEW_EXISTS',
        'You have already reviewed this product. Edit your review instead.',
      ),
    );
  }

  private toAdminRow(
    doc: ReviewLean,
    productName: Map<string, string>,
    storeName: Map<string, string>,
  ): AdminReviewRow {
    return {
      id: doc._id.toString(),
      productId: doc.productId.toString(),
      productName: productName.get(doc.productId.toString()) ?? 'Deleted product',
      vendorId: doc.vendorId.toString(),
      storeName: storeName.get(doc.vendorId.toString()) ?? 'Store',
      customerId: doc.customerId.toString(),
      orderId: doc.orderId.toString(),
      authorName: doc.authorName,
      rating: doc.rating,
      comment: doc.comment ?? null,
      isHidden: doc.isHidden,
      hiddenReason: doc.hiddenReason ?? null,
      hiddenAt: doc.hiddenAt ? doc.hiddenAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
      editedAt: doc.editedAt ? doc.editedAt.toISOString() : null,
    };
  }
}
