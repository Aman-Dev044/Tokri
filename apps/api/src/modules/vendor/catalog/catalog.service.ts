import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  Category,
  CategoryDocument,
} from '../../../database/schemas/category.schema';
import {
  Product,
  ProductDocument,
  ProductUnit,
} from '../../../database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import { AisleKey } from '../../../common/constants/aisle.enum';
import { IN_FLIGHT_STATUSES } from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../../admin/audit/audit.service';
import {
  escapeRegex,
  iso,
  isDuplicateKeyError,
  slugify,
} from '../common/dto';
import { scopeId, toObjectIdOrNull } from '../common/vendor-scope.decorator';
import {
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto';

export interface CategoryRow {
  id: string;
  vendorId: string | null;
  /** `true` when `vendorId` is null — the shared platform taxonomy. */
  isGlobal: boolean;
  name: string;
  slug: string;
  aisleKey: AisleKey;
  parentId: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: string | null;
}

export interface ProductRow {
  id: string;
  vendorId: string;
  categoryId: string;
  categoryName: string | null;
  aisleKey: AisleKey | null;
  name: string;
  slug: string;
  description: string | null;
  images: string[];
  brand: string | null;
  unit: ProductUnit;
  unitValue: number;
  sku: string;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE. */
  price: number;
  discountPct: number;
  isActive: boolean;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

type CategoryRecord = Category & {
  _id: Types.ObjectId;
  createdAt?: Date;
};

interface ProductAggregateRow {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string | null;
  images?: string[];
  brand?: string | null;
  unit: ProductUnit;
  unitValue: number;
  sku: string;
  mrp: number;
  price: number;
  discountPct: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  stock?: number;
  reserved?: number;
  lowStockThreshold?: number;
  category?: { name?: string; aisleKey?: AisleKey };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  CATALOGUE
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Categories: two tenants, one collection ─────────────────────────────
 * `Category.vendorId === null` is the PLATFORM taxonomy — the eight
 * aisles every store shares, so "sales by aisle" rolls up across the
 * marketplace. A vendor READS those and may add private ones of their
 * own, but every write path asserts `vendorId === scope`, so a global
 * category (or another vendor's) is a 404 to edit or delete.
 *
 * ── Products: the inventory row is created with the product ─────────────
 * Stock lives only in `inventory` (§5.2). A product without its
 * inventory document is invisible to every stock query and unsellable,
 * so the two are written in ONE transaction, along with the opening
 * `InventoryLog` row that makes the starting quantity reconstructable.
 */
@Injectable()
export class VendorCatalogService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'updatedAt',
    'name',
    'price',
    'sku',
    'stock',
  ]);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  Categories
  // ══════════════════════════════════════════════════════════════════

  async listCategories(vendorScope: string): Promise<CategoryRow[]> {
    const vendorId = scopeId(vendorScope);

    const rows = await this.categories
      .find({ $or: [{ vendorId }, { vendorId: null }] })
      .sort({ aisleKey: 1, sortOrder: 1, name: 1 })
      .lean<CategoryRecord[]>()
      .exec();

    if (rows.length === 0) return [];

    // Counted against THIS vendor's products only: a global category's
    // platform-wide product count is not the vendor's business.
    const counts = await this.products
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            vendorId,
            categoryId: { $in: rows.map((row) => row._id) },
          },
        },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } },
      ])
      .exec();

    const byId = new Map(counts.map((row) => [row._id.toString(), row.count]));

    return rows.map((row) => toCategoryRow(row, byId.get(row._id.toString())));
  }

  async createCategory(
    vendorScope: string,
    dto: CreateCategoryDto,
    actor: JwtUser,
  ): Promise<CategoryRow> {
    const vendorId = scopeId(vendorScope);
    const parentId = await this.resolveParent(vendorScope, dto.parentId ?? null);

    try {
      const created = await this.categories.create({
        vendorId,
        name: dto.name,
        slug: slugify(dto.name),
        parentId,
        aisleKey: dto.aisleKey,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      });

      await this.audit.record({
        action: 'vendor.category.create',
        entity: 'Category',
        entityId: created._id.toString(),
        before: null,
        after: { name: created.name, aisleKey: created.aisleKey },
        actor,
      });

      return toCategoryRow(created.toObject() as CategoryRecord, 0);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          `A category with the slug "${slugify(dto.name)}" already exists in this store`,
        );
      }
      throw error;
    }
  }

  async updateCategory(
    vendorScope: string,
    id: string,
    dto: UpdateCategoryDto,
    actor: JwtUser,
  ): Promise<CategoryRow> {
    const category = await this.mustFindOwnCategory(vendorScope, id);
    const before = {
      name: category.name,
      aisleKey: category.aisleKey,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    };

    if (dto.name !== undefined) {
      category.name = dto.name;
      category.slug = slugify(dto.name);
    }
    if (dto.aisleKey !== undefined) category.aisleKey = dto.aisleKey;
    if (dto.imageUrl !== undefined) category.imageUrl = dto.imageUrl;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      category.parentId = await this.resolveParent(vendorScope, dto.parentId);
    }

    try {
      await category.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A category with that slug already exists in this store',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'vendor.category.update',
      entity: 'Category',
      entityId: id,
      before,
      after: {
        name: category.name,
        aisleKey: category.aisleKey,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      },
      actor,
    });

    const count = await this.products
      .countDocuments({ vendorId: scopeId(vendorScope), categoryId: category._id })
      .exec();

    return toCategoryRow(category.toObject() as CategoryRecord, count);
  }

  /**
   * Refused while anything still points at it.
   *
   * Deleting a referenced category orphans products into a categoryId
   * that resolves to nothing — they vanish from the customer UI without
   * ever being deactivated, which is the worst of both outcomes.
   */
  async deleteCategory(
    vendorScope: string,
    id: string,
    actor: JwtUser,
  ): Promise<void> {
    const category = await this.mustFindOwnCategory(vendorScope, id);

    const [products, children] = await Promise.all([
      this.products.countDocuments({ categoryId: category._id }).exec(),
      this.categories.countDocuments({ parentId: category._id }).exec(),
    ]);

    if (products > 0 || children > 0) {
      throw new ConflictException(
        `Category still holds ${products} product(s) and ${children} sub-category(ies). ` +
          'Move or deactivate them first.',
      );
    }

    await this.categories.deleteOne({ _id: category._id }).exec();

    await this.audit.record({
      action: 'vendor.category.delete',
      entity: 'Category',
      entityId: id,
      before: { name: category.name, aisleKey: category.aisleKey },
      after: null,
      actor,
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  Products
  // ══════════════════════════════════════════════════════════════════

  async listProducts(
    vendorScope: string,
    query: ListProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<ProductDocument> = {
      vendorId: scopeId(vendorScope),
    };
    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.isActive !== undefined) filter.isActive = query.isActive;

    if (query.q) {
      const needle = escapeRegex(query.q);
      filter.$or = [
        { name: { $regex: needle, $options: 'i' } },
        { brand: { $regex: needle, $options: 'i' } },
        { sku: { $regex: needle, $options: 'i' } },
      ];
    }

    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'inventory',
          localField: '_id',
          foreignField: 'productId',
          pipeline: [
            { $project: { stock: 1, reserved: 1, lowStockThreshold: 1 } },
          ],
          as: 'inv',
        },
      },
      { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          stock: { $ifNull: ['$inv.stock', 0] },
          reserved: { $ifNull: ['$inv.reserved', 0] },
          lowStockThreshold: { $ifNull: ['$inv.lowStockThreshold', 0] },
        },
      },
    ];

    if (query.lowStock) {
      pipeline.push({
        $match: { $expr: { $lte: ['$stock', '$lowStockThreshold'] } },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'categories',
          localField: 'categoryId',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, aisleKey: 1 } }],
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    );

    // One $facet, so the total is produced by the SAME pipeline as the
    // rows: countDocuments cannot see the post-lookup lowStock filter,
    // and a total that disagrees with the page is how "page 4 of 3"
    // bugs appear.
    const [result] = await this.products
      .aggregate<{ rows: ProductAggregateRow[]; total: { count: number }[] }>([
        ...pipeline,
        {
          $facet: {
            rows: [
              { $sort: this.resolveSort(query.sort) },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    return paginate(
      (result?.rows ?? []).map(toProductRow),
      result?.total?.[0]?.count ?? 0,
      page,
      limit,
    );
  }

  async findProduct(vendorScope: string, id: string): Promise<ProductRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Product not found');
    }

    const [row] = await this.products
      .aggregate<ProductAggregateRow>([
        {
          // BOTH clauses, always. `_id` alone would happily return
          // another vendor's product.
          $match: {
            _id: new Types.ObjectId(id),
            vendorId: scopeId(vendorScope),
          },
        },
        {
          $lookup: {
            from: 'inventory',
            localField: '_id',
            foreignField: 'productId',
            pipeline: [
              { $project: { stock: 1, reserved: 1, lowStockThreshold: 1 } },
            ],
            as: 'inv',
          },
        },
        { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            stock: { $ifNull: ['$inv.stock', 0] },
            reserved: { $ifNull: ['$inv.reserved', 0] },
            lowStockThreshold: { $ifNull: ['$inv.lowStockThreshold', 0] },
          },
        },
        {
          $lookup: {
            from: 'categories',
            localField: 'categoryId',
            foreignField: '_id',
            pipeline: [{ $project: { name: 1, aisleKey: 1 } }],
            as: 'category',
          },
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    if (!row) throw new NotFoundException('Product not found');
    return toProductRow(row);
  }

  /**
   * Product + inventory row + opening stock log, in ONE transaction.
   *
   * Atlas is a replica set, so this is a real transaction. If the
   * inventory insert fails, the product is rolled back too — a product
   * with no inventory document is unsellable and invisible to every
   * stock report, which is a worse state than not having created it.
   */
  async createProduct(
    vendorScope: string,
    dto: CreateProductDto,
    actor: JwtUser,
  ): Promise<ProductRow> {
    if (dto.price > dto.mrp) {
      throw new BadRequestException('price cannot exceed mrp');
    }

    const vendorId = scopeId(vendorScope);
    const category = await this.assertUsableCategory(vendorScope, dto.categoryId);
    const openingStock = dto.openingStock ?? 0;
    const threshold = dto.lowStockThreshold ?? 10;

    const session = await this.connection.startSession();
    let productId: Types.ObjectId | null = null;

    try {
      await session.withTransaction(async () => {
        const [product] = await this.products.create(
          [
            {
              vendorId,
              categoryId: category._id,
              name: dto.name,
              slug: `${slugify(dto.name)}-${vendorScope.slice(-6)}`,
              description: dto.description ?? null,
              images: dto.images ?? [],
              brand: dto.brand ?? null,
              unit: dto.unit,
              unitValue: dto.unitValue,
              sku: dto.sku,
              mrp: dto.mrp,
              price: dto.price,
              discountPct:
                dto.mrp > 0
                  ? Math.round(((dto.mrp - dto.price) / dto.mrp) * 100)
                  : 0,
              isActive: dto.isActive ?? true,
              searchText:
                `${dto.name} ${dto.brand ?? ''} ${category.aisleKey}`
                  .trim()
                  .toLowerCase(),
            },
          ],
          { session },
        );

        productId = product._id;

        await this.inventory.create(
          [
            {
              vendorId,
              productId: product._id,
              stock: openingStock,
              reserved: 0,
              lowStockThreshold: threshold,
            },
          ],
          { session },
        );

        if (openingStock > 0) {
          await this.inventoryLogs.create(
            [
              {
                vendorId,
                productId: product._id,
                delta: openingStock,
                reason: InventoryReason.RESTOCK,
                refId: null,
                byUserId: toObjectIdOrNull(actor.sub),
                at: new Date(),
              },
            ],
            { session },
          );
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          `SKU "${dto.sku}" is already used by another product in this store`,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    // `productId` is assigned inside the transaction callback, which
    // TypeScript cannot see through; the throw is unreachable in
    // practice and exists so the type narrows without a non-null
    // assertion (banned by the lint config).
    if (!productId) throw new ConflictException('Product creation failed');

    await this.audit.record({
      action: 'vendor.product.create',
      entity: 'Product',
      entityId: String(productId),
      before: null,
      after: { name: dto.name, sku: dto.sku, price: dto.price },
      actor,
    });

    return this.findProduct(vendorScope, String(productId));
  }

  async updateProduct(
    vendorScope: string,
    id: string,
    dto: UpdateProductDto,
    actor: JwtUser,
  ): Promise<ProductRow> {
    const product = await this.mustFindOwnProduct(vendorScope, id);

    const before = {
      name: product.name,
      price: product.price,
      mrp: product.mrp,
      isActive: product.isActive,
      categoryId: product.categoryId.toString(),
    };

    if (dto.categoryId !== undefined) {
      const category = await this.assertUsableCategory(
        vendorScope,
        dto.categoryId,
      );
      product.categoryId = category._id;
    }
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.images !== undefined) product.images = dto.images;
    if (dto.brand !== undefined) product.brand = dto.brand;
    if (dto.unit !== undefined) product.unit = dto.unit;
    if (dto.unitValue !== undefined) product.unitValue = dto.unitValue;
    if (dto.mrp !== undefined) product.mrp = dto.mrp;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.isActive !== undefined) product.isActive = dto.isActive;

    if (product.price > product.mrp) {
      throw new BadRequestException('price cannot exceed mrp');
    }

    product.discountPct =
      product.mrp > 0
        ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
        : 0;
    product.searchText = `${product.name} ${product.brand ?? ''}`
      .trim()
      .toLowerCase();

    await product.save();

    await this.audit.record({
      action: 'vendor.product.update',
      entity: 'Product',
      entityId: id,
      before,
      after: {
        name: product.name,
        price: product.price,
        mrp: product.mrp,
        isActive: product.isActive,
        categoryId: product.categoryId.toString(),
      },
      actor,
    });

    return this.findProduct(vendorScope, id);
  }

  /**
   * Hard delete, refused while an in-flight order references the product.
   *
   * Orders snapshot the name, price and image at checkout, so deleting a
   * product never corrupts order history. An order still being packed is
   * different: the vendor is about to look at a line whose stock row no
   * longer exists.
   */
  async deleteProduct(
    vendorScope: string,
    id: string,
    actor: JwtUser,
  ): Promise<void> {
    const product = await this.mustFindOwnProduct(vendorScope, id);

    const live = await this.orders
      .countDocuments({
        vendorId: scopeId(vendorScope),
        status: { $in: [...IN_FLIGHT_STATUSES] },
        'items.productId': product._id,
      })
      .exec();

    if (live > 0) {
      throw new ConflictException(
        `${live} in-flight order(s) contain this product. Deactivate it ` +
          'instead — it will stop selling immediately and can be deleted ' +
          'once those orders close.',
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.products
          .deleteOne({ _id: product._id, vendorId: scopeId(vendorScope) })
          .session(session)
          .exec();
        await this.inventory
          .deleteOne({ productId: product._id })
          .session(session)
          .exec();
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.product.delete',
      entity: 'Product',
      entityId: id,
      before: { name: product.name, sku: product.sku },
      after: null,
      actor,
    });
  }

  /** Used by the image controller to prove the product is the caller's. */
  async assertOwnsProduct(vendorScope: string, id: string): Promise<void> {
    await this.mustFindOwnProduct(vendorScope, id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════════

  private resolveSort(sort?: string): Record<string, 1 | -1> {
    const raw = sort ?? '-createdAt';
    const descending = raw.startsWith('-');
    const field = descending ? raw.slice(1) : raw;

    // An allowlist, never pass-through: an arbitrary sort key orders by
    // a field the caller may not read, which leaks it one bit at a time.
    if (!VendorCatalogService.SORTABLE.has(field)) {
      return { createdAt: -1 };
    }
    return { [field]: descending ? -1 : 1 };
  }

  private async mustFindOwnCategory(
    vendorScope: string,
    id: string,
  ): Promise<CategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Category not found');
    }

    // `vendorId: scope` — NOT `{ $or: [..., { vendorId: null }] }`. The
    // global taxonomy is readable by every vendor and writable by none
    // of them.
    const category = await this.categories
      .findOne({ _id: new Types.ObjectId(id), vendorId: scopeId(vendorScope) })
      .exec();

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private async mustFindOwnProduct(
    vendorScope: string,
    id: string,
  ): Promise<ProductDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Product not found');
    }

    const product = await this.products
      .findOne({ _id: new Types.ObjectId(id), vendorId: scopeId(vendorScope) })
      .exec();

    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /** A category the vendor may file a product under: their own, or global. */
  private async assertUsableCategory(
    vendorScope: string,
    id: string,
  ): Promise<CategoryRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Category not found');
    }

    const category = await this.categories
      .findOne({
        _id: new Types.ObjectId(id),
        $or: [{ vendorId: scopeId(vendorScope) }, { vendorId: null }],
      })
      .lean<CategoryRecord | null>()
      .exec();

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private async resolveParent(
    vendorScope: string,
    parentId: string | null,
  ): Promise<Types.ObjectId | null> {
    if (!parentId) return null;
    const parent = await this.assertUsableCategory(vendorScope, parentId);
    return parent._id;
  }
}

function toCategoryRow(row: CategoryRecord, productCount = 0): CategoryRow {
  return {
    id: row._id.toString(),
    vendorId: row.vendorId ? row.vendorId.toString() : null,
    isGlobal: !row.vendorId,
    name: row.name,
    slug: row.slug,
    aisleKey: row.aisleKey,
    parentId: row.parentId ? row.parentId.toString() : null,
    imageUrl: row.imageUrl ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount,
    createdAt: iso(row.createdAt),
  };
}

function toProductRow(row: ProductAggregateRow): ProductRow {
  const stock = row.stock ?? 0;
  const threshold = row.lowStockThreshold ?? 0;

  return {
    id: row._id.toString(),
    vendorId: row.vendorId.toString(),
    categoryId: row.categoryId.toString(),
    categoryName: row.category?.name ?? null,
    aisleKey: row.category?.aisleKey ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    images: row.images ?? [],
    brand: row.brand ?? null,
    unit: row.unit,
    unitValue: row.unitValue,
    sku: row.sku,
    mrp: row.mrp,
    price: row.price,
    discountPct: row.discountPct,
    isActive: row.isActive,
    stock,
    reserved: row.reserved ?? 0,
    lowStockThreshold: threshold,
    isLowStock: stock <= threshold,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
