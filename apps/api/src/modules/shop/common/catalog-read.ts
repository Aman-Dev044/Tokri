import { Model, Types } from 'mongoose';

import { AisleKey } from '../../../common/constants/aisle.enum';
import { CategoryDocument } from '../../../database/schemas/category.schema';
import { InventoryDocument } from '../../../database/schemas/inventory.schema';

/**
 * The two batched lookups every `ProductRow` needs, for readers outside
 * `DiscoveryService` (the wishlist, "order again").
 *
 * Both are ONE query for the whole page, never one per row — per-row
 * lookups are the N+1 that makes a list endpoint fine in development and
 * slow with a real catalogue behind it.
 */
export async function stockByProduct(
  inventory: Model<InventoryDocument>,
  productIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const rows = await inventory
    .find({ productId: { $in: productIds } })
    .select('productId stock')
    .lean<{ productId: Types.ObjectId; stock: number }[]>()
    .exec();

  return new Map(rows.map((row) => [row.productId.toString(), row.stock]));
}

export async function aisleByCategory(
  categories: Model<CategoryDocument>,
  categoryIds: Types.ObjectId[],
): Promise<Map<string, AisleKey>> {
  if (categoryIds.length === 0) return new Map();

  const unique = [...new Set(categoryIds.map((id) => id.toString()))].map(
    (id) => new Types.ObjectId(id),
  );

  const rows = await categories
    .find({ _id: { $in: unique } })
    .select('aisleKey')
    .lean<{ _id: Types.ObjectId; aisleKey: AisleKey }[]>()
    .exec();

  return new Map(rows.map((row) => [row._id.toString(), row.aisleKey]));
}
