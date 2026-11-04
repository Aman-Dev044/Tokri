import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import {
  RequirePermission,
} from '../../../common/decorators/require-permission.decorator';
import { Permission } from '../../../common/constants/permissions';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  CategoryRow,
  ProductRow,
  VendorCatalogService,
} from './catalog.service';
import { PresignedUpload, VendorImagesService } from './images.service';
import {
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  PresignImageDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto';

/**
 * Categories and products for the caller's own store.
 *
 * Every id in a path is resolved with `{ _id, vendorId: scope }` — both
 * clauses, always. Addressing another vendor's product returns 404, not
 * 403: a 403 would confirm the id exists and turn the endpoint into an
 * enumeration oracle.
 */
@ApiTags('vendor/catalog')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@ApiNotFoundResponse({ description: 'No such resource in this store.' })
@Controller('vendor')
@Roles(Role.VENDOR, Role.STAFF)
@UseInterceptors(AuditInterceptor)
export class VendorCatalogController {
  constructor(
    private readonly catalog: VendorCatalogService,
    private readonly images: VendorImagesService,
  ) {}

  // ── Categories ──────────────────────────────────────────────────────

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get('categories')
  @ApiOperation({
    summary: 'Own categories plus the platform taxonomy',
    description:
      'Not paginated — the tree is small and the UI renders it whole. ' +
      'Rows with `isGlobal: true` are the shared eight-aisle taxonomy: ' +
      'readable by every vendor, writable by none.',
  })
  listCategories(@VendorScope() scope: string): Promise<CategoryRow[]> {
    return this.catalog.listCategories(scope);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category (always private to the store)' })
  @ApiConflictResponse({ description: 'Slug already used in this store.' })
  createCategory(
    @VendorScope() scope: string,
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CategoryRow> {
    return this.catalog.createCategory(scope, dto, actor);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update one of the store’s own categories' })
  updateCategory(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CategoryRow> {
    return this.catalog.updateCategory(scope, id, dto, actor);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description: 'Refused with 409 while products or children point at it.',
  })
  @ApiConflictResponse({ description: 'Still referenced.' })
  deleteCategory(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.catalog.deleteCategory(scope, id, actor);
  }

  // ── Products ────────────────────────────────────────────────────────

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get('products')
  @ApiOperation({
    summary: 'Product list (paginated)',
    description:
      'Filters: `q` over name/brand/sku, `categoryId`, `isActive`, ' +
      '`lowStock`. Live stock is joined from `inventory` — it is never ' +
      'stored on the product (§5.2).',
  })
  listProducts(
    @VendorScope() scope: string,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    return this.catalog.listProducts(scope, query);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a product',
    description:
      'Writes the product, its inventory row and the opening stock log ' +
      'in ONE transaction. `slug` and `searchText` are derived server-side.',
  })
  @ApiConflictResponse({ description: 'SKU already used in this store.' })
  createProduct(
    @VendorScope() scope: string,
    @Body() dto: CreateProductDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<ProductRow> {
    return this.catalog.createProduct(scope, dto, actor);
  }

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get('products/:id')
  @ApiOperation({ summary: 'One product, with live stock' })
  findProduct(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<ProductRow> {
    return this.catalog.findProduct(scope, id);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  updateProduct(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<ProductRow> {
    return this.catalog.updateProduct(scope, id, dto, actor);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a product and its inventory row',
    description:
      'Refused with 409 while an in-flight order contains it. Order ' +
      'history is unaffected either way: every line snapshots its own ' +
      'name, price and image at checkout.',
  })
  @ApiConflictResponse({ description: 'Referenced by an in-flight order.' })
  deleteProduct(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.catalog.deleteProduct(scope, id, actor);
  }

  @RequirePermission(Permission.PRODUCTS_MANAGE)
  @Post('products/:id/images')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Presigned S3 PUT for a product image',
    description:
      'The file NEVER passes through this API. `contentType` is ' +
      'allowlisted and `sizeBytes` is capped at 5 MB — and both are ' +
      'SIGNED into the URL, so storage rejects anything else rather than ' +
      'trusting the browser. Returns 503 while object storage is ' +
      'unconfigured; the rest of the module keeps working.',
  })
  @ApiServiceUnavailableResponse({ description: 'image upload not configured' })
  async presignImage(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: PresignImageDto,
  ): Promise<PresignedUpload> {
    // Ownership first: an unconfigured bucket must not be the reason a
    // caller learns whether another vendor's product id exists.
    await this.catalog.assertOwnsProduct(scope, id);

    return this.images.presignProductImage(
      scope,
      id,
      dto.contentType,
      dto.sizeBytes,
    );
  }
}
