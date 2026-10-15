import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * `GET /notifications?page=&limit=`
 *
 * No extra filters: this list is always "the caller's own notifications,
 * newest first" — there is nothing else to narrow it by, and a `userId`
 * filter would be attacker-controlled input pretending to be one.
 */
export class ListNotificationsQueryDto extends PaginationQueryDto {}
