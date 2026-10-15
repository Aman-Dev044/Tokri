import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Owns } from '../../common/decorators/owns.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated';
import { Notification } from '../../database/schemas/notification.schema';
import { ListNotificationsQueryDto } from './dto';
import { NotificationRow, NotificationsService } from './notifications.service';

/**
 * The caller's own notifications. No `@Roles()`: a customer, a vendor, a
 * rider and an admin all receive notifications, so authentication alone
 * is the gate — every query below is additionally scoped to `user.sub`,
 * never to an id taken from a param, query or body.
 *
 * `PATCH :id/read` carries `@Owns(...)`, so `ResourceOwnerGuard` (an
 * APP_GUARD, already wired globally) turns another user's notification
 * id into a 404 before the handler runs — never a 403, for the same
 * enumeration-oracle reason every other owned resource in this API uses
 * 404.
 *
 * Nothing here is `@Public()`.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'The caller\'s notifications, newest first' })
  list(
    @CurrentUser() user: JwtUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationRow>> {
    return this.notifications.list(user.sub, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many are unread' })
  unreadCount(@CurrentUser() user: JwtUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(user.sub);
  }

  @Patch(':id/read')
  @Owns({ model: Notification.name, param: 'id', field: 'userId' })
  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiNotFoundResponse({
    description: 'Unknown id, malformed id, or another user\'s notification — all 404.',
  })
  markRead(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<NotificationRow> {
    return this.notifications.markRead(user.sub, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every one of the caller\'s notifications read' })
  markAllRead(@CurrentUser() user: JwtUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.sub);
  }
}
