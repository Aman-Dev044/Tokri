import {
  Body,
  Controller,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import {
  AdminReviewRow,
  MyReviewState,
  ReviewPage,
  ReviewRow,
  ReviewsService,
} from './reviews.service';
import {
  AdminListReviewsQueryDto,
  CreateReviewDto,
  ListReviewsQueryDto,
  SetReviewVisibilityDto,
  UpdateReviewDto,
} from './dto';

/**
 * Product reviews: one public read, three customer routes.
 *
 * Every route names its access explicitly — `@Public()` on the read (it is
 * listed in `public-routes.spec.ts`), `@Roles(Role.CUSTOMER)` on the rest.
 * No route takes a review id: a customer's review is addressed as "mine on
 * this product", resolved from the token, so there is no id to guess.
 */
@ApiTags('shop/reviews')
@Controller('products/:id/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Visible reviews of one product, newest first',
    description:
      '`{ data, meta, summary: { average, count } }`. Hidden reviews are ' +
      'excluded from the list AND from the summary. Same 404 rule as ' +
      '`GET /products/:id`.',
  })
  @ApiOkResponse({ description: 'ReviewPage' })
  list(
    @Param('id') id: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<ReviewPage> {
    return this.reviews.listPublic(id, query);
  }

  @Get('mine')
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @ApiOperation({
    summary: 'My review of this product, and whether I may write one',
    description:
      'Returns the caller\'s own review even when an admin has hidden it ' +
      '(`isHidden: true`). `canReview` is true only with no review yet and ' +
      'a delivered order containing the product.',
  })
  mine(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<MyReviewState> {
    return this.reviews.mine(user.sub, id);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Review a product you have received',
    description: 'Rating 1-5, optional comment up to 500 characters.',
  })
  @ApiForbiddenResponse({ description: '`REVIEW_NEEDS_DELIVERED_ORDER`.' })
  @ApiConflictResponse({ description: '`REVIEW_EXISTS` — edit it instead.' })
  create(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewRow & { isHidden: boolean }> {
    return this.reviews.create(user.sub, id, dto);
  }

  @Patch('mine')
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Edit my review of this product' })
  @ApiNotFoundResponse({ description: 'No review of this product by the caller.' })
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewRow & { isHidden: boolean }> {
    return this.reviews.update(user.sub, id, dto);
  }
}

/**
 * Moderation. `@Roles(Role.ADMIN)` — SUPER_ADMIN inherits it — and every
 * write is audited by `ReviewsService.setVisibility` itself; the
 * interceptor is the safety net for anything that ever is not.
 */
@ApiTags('admin/reviews')
@ApiBearerAuth()
@Controller('admin/reviews')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary: 'Every review, newest first (paginated)',
    description: 'Filters: `status` (visible | hidden), `rating`, `productId`.',
  })
  list(
    @Query() query: AdminListReviewsQueryDto,
  ): Promise<Paginated<AdminReviewRow>> {
    return this.reviews.adminList(query);
  }

  @Patch(':id/visibility')
  @ApiOperation({
    summary: 'Hide or restore a review, with a reason',
    description:
      'Audited as `review.hide` / `review.unhide`. The product\'s rating ' +
      'average and count are recomputed without hidden reviews.',
  })
  setVisibility(
    @Param('id') id: string,
    @Body() dto: SetReviewVisibilityDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<AdminReviewRow> {
    return this.reviews.setVisibility(id, dto, actor);
  }
}
