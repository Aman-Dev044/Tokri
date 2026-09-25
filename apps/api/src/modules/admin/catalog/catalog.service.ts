import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

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
  AISLE_KEYS,
  AisleKey,
} from '../../../common/constants/aisle.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import {
  CreateCategoryDto,
  ListProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductStatusDto,
} from './dto';

export interface CategoryRow {
  id: string;
  vendorId: string | null;
  name: string;
  slug: string;
  parentId: string | null;
  aisleKey: AisleKey;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface AisleGroup {
  aisleKey: AisleKey;
  categories: CategoryRow[];
}

export interface ProductRow {
  id: string;
  vendorId: string;
  vendorName: string | null;
  categoryId: string;
  categoryName: string | null;
  aisleKey: AisleKey | null;
  name: string;
  slug: string;
  brand: string | null;
  image: string | null;
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
  lowStockThreshold: number;
  isLowStock: boolean;
  createdAt: string | null;
}

type CategoryRecord = Category & {
  _id: Types.ObjectId;
  productCount?: number;
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

@Injectable()
export class AdminCatalogService {
  private static readonly PRODUCT_SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'name',
    'price',
    'mrp',
    'stock',
  ]);

  constructor(
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Categories
  // ────────────────────────────────────────────────────────────────────

  /**
   * Categories grouped by aisle, all eight aisles always present.
   *
   * The UI renders one coloured column per aisle; an aisle missing from
   * the payload would collapse its column and shuffle the others, so an
   * empty aisle is an empty array, never an absent key.
   */
  async listCategories(): Promise<AisleGroup[]> {
    const rows = await this.categories
      .aggregate<CategoryRecord>([
        {
          $lookup: {
            from: 'products',
            let: { categoryId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$categoryId', '$$categoryId'] } } },
              { $count: 'count' },
            ],
            as: 'products',
          },
        },
        {
          $addFields: {
            productCount: {
              $ifNull: [{ $arrayElemAt: ['$products.count', 0] }, 0],
            },
          },
        },
        { $project: { products: 0 } },
        { $sort: { sortOrder: 1, name: 1 } },
      ])
      .exec();

    const grouped = new Map<AisleKey, CategoryRow[]>(
      AISLE_KEYS.map((aisleKey) => [aisleKey, []]),
    );

    for (const row of rows) {
      grouped.get(row.aisleKey)?.push(toCategoryRow(row));
    }

    return AISLE_KEYS.map((aisleKey) => ({
      aisleKey,
      categories: grouped.get(aisleKey) ?? [],
    }));
  }

  async createCategory(
    dto: CreateCategoryDto,
    actor: JwtUser,
  ): Promise<CategoryRow> {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) {
      throw new BadRequestException('name must contain at least one letter or digit');
    }

    try {
      const created = await this.categories.create({
        vendorId: dto.vendorId ? new Types.ObjectId(dto.vendorId) : null,
        name: dto.name,
        slug,
        parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null,
        aisleKey: dto.aisleKey,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        isDemo: false,
      });

      await this.audit.record({
        action: 'category.create',
        entity: 'Category',
        entityId: created._id.toString(),
        before: null,
        after: { name: created.name, slug, aisleKey: created.aisleKey },
        actor,
      });

      return toCategoryRow(created.toObject<CategoryRecord>());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A category with this slug already exists for this vendor',
        );
      }
      throw error;
    }
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    actor: JwtUser,
  ): Promise<CategoryRow> {
    const category = await this.mustFindCategory(id);

    const before = {
      name: category.name,
      slug: category.slug,
      aisleKey: category.aisleKey,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      imageUrl: category.imageUrl ?? null,
    };

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.slug !== undefined) category.slug = dto.slug;
    if (dto.aisleKey !== undefined) category.aisleKey = dto.aisleKey;
    if (dto.imageUrl !== undefined) category.imageUrl = dto.imageUrl;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;

    try {
      await category.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A category with this slug already exists for this vendor',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'category.update',
      entity: 'Category',
      entityId: id,
      before,
      after: {
        name: category.name,
        slug: category.slug,
        aisleKey: category.aisleKey,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        imageUrl: category.imageUrl ?? null,
      },
      actor,
    });

    return toCategoryRow(category.toObject<CategoryRecord>());
  }

  /**
   * Refuses to delete a category that still has products.
   *
   * Cascading would orphan every product's `categoryId` and knock a hole
   * in the sales-by-aisle report, which resolves the aisle THROUGH the
   * category. Deactivating is the non-destructive alternative and is what
   * the error tells the operator to do.
   */
  async deleteCategory(id: string, actor: JwtUser): Promise<void> {
    const category = await this.mustFindCategory(id);

    const [productCount, childCount] = await Promise.all([
      this.products.countDocuments({ categoryId: category._id }).exec(),
      this.categories.countDocuments({ parentId: category._id }).exec(),
    ]);

    if (productCount > 0) {
      throw new ConflictException(
        `This category still holds ${productCount} product(s). Move them or ` +
          'deactivate the category instead.',
      );
    }
    if (childCount > 0) {
      throw new ConflictException(
        `This category has ${childCount} child categor(ies). Delete them first.`,
      );
    }

    await this.categories.deleteOne({ _id: category._id }).exec();

    await this.audit.record({
      action: 'category.delete',
      entity: 'Category',
      entityId: id,
      before: {
        name: category.name,
        slug: category.slug,
        aisleKey: category.aisleKey,
      },
      after: null,
      actor,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Products
  // ────────────────────────────────────────────────────────────────────

  /**
   * The cross-vendor catalogue, with live stock joined from `inventory`.
   *
   * Stock is looked up rather than read off the product, because the
   * product document does not carry it — see the note on the Inventory
   * schema about why two copies of a quantity is how oversell happens.
   */
  async listProducts(
    query: ListProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<ProductDocument> = {};
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: needle }, { brand: needle }, { sku: needle }];
    }

    const sort = this.resolveProductSort(query.sort);

    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'inventory',
          localField: '_id',
          foreignField: 'productId',
          as: 'inv',
        },
      },
      { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'vendors',
          localField: 'vendorId',
          foreignField: '_id',
          as: 'vendor',
        },
      },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'categoryId',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          stock: { $ifNull: ['$inv.stock', 0] },
          lowStockThreshold: { $ifNull: ['$inv.lowStockThreshold', 0] },
        },
      },
    ];

    if (query.aisleKey) {
      pipeline.push({ $match: { 'category.aisleKey': query.aisleKey } });
    }
    if (query.lowStock) {
      pipeline.push({
        $match: { $expr: { $lte: ['$stock', '$lowStockThreshold'] } },
      });
    }

    // countDocuments cannot see the post-lookup filters, so the total is
    // produced by the same pipeline through a $facet. Counting separately
    // would report a total that does not match the rows on the page.
    const [result] = await this.products
      .aggregate<{ rows: ProductAggregateRow[]; total: { count: number }[] }>([
        ...pipeline,
        {
          $facet: {
            rows: [
              { $sort: sort },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const rows = result?.rows ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    return paginate(rows.map(toProductRow), total, page, limit);
  }

  async updateProductStatus(
    id: string,
    dto: UpdateProductStatusDto,
    actor: JwtUser,
  ): Promise<ProductRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Product not found');
    }
    const product = await this.products.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');

    const before = { isActive: product.isActive };
    product.isActive = dto.isActive;
    await product.save();

    await this.audit.record({
      action: 'product.status.update',
      entity: 'Product',
      entityId: id,
      before,
      after: { isActive: dto.isActive, reason: dto.reason ?? null },
      actor,
    });

    const page = await this.listProducts({ page: 1, limit: 1, q: product.sku });
    const row = page.data[0];
    if (row) return row;

    // The SKU search is a convenience, not a guarantee; fall back to the
    // document we already hold rather than 404 on a product we just wrote.
    return toProductRow({
      ...product.toObject<ProductAggregateRow>(),
      stock: 0,
      lowStockThreshold: 0,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────────

  private async mustFindCategory(id: string): Promise<CategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Category not found');
    }
    const category = await this.categories.findById(id).exec();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private resolveProductSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminCatalogService.PRODUCT_SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[
          ...AdminCatalogService.PRODUCT_SORTABLE,
        ].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

interface ProductAggregateRow {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  brand?: string | null;
  images?: string[];
  unit: ProductUnit;
  unitValue: number;
  sku: string;
  mrp: number;
  price: number;
  discountPct: number;
  isActive: boolean;
  stock?: number;
  lowStockThreshold?: number;
  createdAt?: Date;
  vendor?: { storeName?: string };
  category?: { name?: string; aisleKey?: AisleKey };
}

function toCategoryRow(category: CategoryRecord): CategoryRow {
  return {
    id: category._id.toString(),
    vendorId: category.vendorId ? category.vendorId.toString() : null,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ? category.parentId.toString() : null,
    aisleKey: category.aisleKey,
    imageUrl: category.imageUrl ?? null,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount: category.productCount ?? 0,
  };
}

function toProductRow(product: ProductAggregateRow): ProductRow {
  const stock = product.stock ?? 0;
  const threshold = product.lowStockThreshold ?? 0;

  return {
    id: product._id.toString(),
    vendorId: product.vendorId.toString(),
    vendorName: product.vendor?.storeName ?? null,
    categoryId: product.categoryId.toString(),
    categoryName: product.category?.name ?? null,
    aisleKey: product.category?.aisleKey ?? null,
    name: product.name,
    slug: product.slug,
    brand: product.brand ?? null,
    image: product.images?.[0] ?? null,
    unit: product.unit,
    unitValue: product.unitValue,
    sku: product.sku,
    mrp: product.mrp,
    price: product.price,
    discountPct: product.discountPct,
    isActive: product.isActive,
    stock,
    lowStockThreshold: threshold,
    isLowStock: stock <= threshold,
    createdAt: product.createdAt
      ? new Date(product.createdAt).toISOString()
      : null,
  };
}
