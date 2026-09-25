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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import {
  AdminCatalogService,
  AisleGroup,
  CategoryRow,
  ProductRow,
} from './catalog.service';
import {
  CreateCategoryDto,
  ListProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductStatusDto,
} from './dto';

@ApiTags('admin/catalog')
@ApiBearerAuth()
@Controller('admin')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  // ── Categories ──────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({
    summary: 'Categories grouped by aisle',
    description:
      'Returns all eight aisles, each with its categories (possibly an ' +
      'empty array) and a product count per category. Not paginated — the ' +
      'category tree is small and the UI renders it whole.',
  })
  listCategories(): Promise<AisleGroup[]> {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category' })
  @ApiConflictResponse({ description: 'Slug already used by this vendor.' })
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CategoryRow> {
    return this.catalog.createCategory(dto, actor);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category' })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CategoryRow> {
    return this.catalog.updateCategory(id, dto, actor);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'Refused with 409 while products or child categories still point at ' +
      'it — deactivate instead of orphaning them.',
  })
  @ApiConflictResponse({ description: 'Still referenced.' })
  deleteCategory(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.catalog.deleteCategory(id, actor);
  }

  // ── Products ────────────────────────────────────────────────────────

  @Get('products')
  @ApiOperation({
    summary: 'Cross-vendor product list (paginated)',
    description:
      'Filters: vendorId, categoryId, aisleKey, isActive, lowStock and `q` ' +
      'over name / brand / sku. Live stock is joined from `inventory`.',
  })
  listProducts(
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    return this.catalog.listProducts(query);
  }

  @Patch('products/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a product' })
  updateProductStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProductStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<ProductRow> {
    return this.catalog.updateProductStatus(id, dto, actor);
  }
}
