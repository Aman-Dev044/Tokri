import { SetMetadata } from '@nestjs/common';

export const OWNS_KEY = 'owns';

export interface OwnsOptions {
  /**
   * The Mongoose model name as registered with `MongooseModule.forFeature`
   * — i.e. `Order.name`, `'Order'`.
   */
  model: string;
  /** Route parameter holding the document id. Defaults to `id`. */
  param?: string;
  /** Field on the document that holds the owning user's id. */
  field: string;
}

/**
 * Generic ownership check for any resource.
 *
 *     @Owns({ model: 'Order', param: 'id', field: 'customerId' })
 *     @Get('orders/:id')
 *     getOrder(@Param('id') id: string) { … }
 *
 * `ResourceOwnerGuard` loads the document named by the route param and
 * compares `field` to the `sub` claim of the VERIFIED access token.
 *
 * One decorator covers every owned resource in the API, so there is no
 * per-controller ownership code to get subtly wrong — the check is the
 * same one everywhere, which is the only way it stays correct.
 *
 * A mismatch is a 404, never a 403 — see the guard for why.
 */
export const Owns = (options: OwnsOptions) => SetMetadata(OWNS_KEY, options);
