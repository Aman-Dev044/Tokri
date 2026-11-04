import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  ProductReview,
  ProductReviewSchema,
} from '../../database/schemas/product-review.schema';
import { Product, ProductSchema } from '../../database/schemas/product.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Vendor, VendorSchema } from '../../database/schemas/vendor.schema';
import { AdminAuditModule } from '../admin/audit/audit.module';
import {
  AdminReviewsController,
  ReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

/**
 * Product reviews — the customer's write, the public read and the admin's
 * moderation, in one module so the aggregate on `Product` has exactly one
 * writer (`ReviewsService.recompute`).
 *
 * Owns `product_reviews`. Borrows products, orders (the verified-purchase
 * check), users (the author's display name) and vendors (visibility).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductReview.name, schema: ProductReviewSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
    AdminAuditModule,
  ],
  controllers: [ReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
