import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, filter, map } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  assertOneOfIfPresent,
  assertOnlyAllowedKeys,
  parsePagination,
} from '../common/list-query.util';
import { NotificationsService } from './notifications.service';

/** Every route is the caller's own notifications — there is no user id in
 *  any path or query, so there is nothing to scope wrongly. */
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** "You have something new" as a server-sent ping — no payload, the
   *  bell re-reads GET /notifications, same as the activity feed does. */
  @Sse('stream')
  stream(@CurrentUser() user: AuthenticatedUser): Observable<{ data: string }> {
    return this.notifications.onNotified().pipe(
      filter((id) => id === user.id),
      map(() => ({ data: 'changed' })),
    );
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { unread?: string; limit?: string; offset?: string },
  ) {
    assertOnlyAllowedKeys(query, ['unread', 'limit', 'offset']);
    assertOneOfIfPresent(query.unread, 'unread', ['true', 'false']);
    const { limit, offset } = parsePagination(query);
    return this.notifications.list(user.id, query.unread === 'true', limit, offset);
  }

  // Declared before :id/read so 'read-all' is never parsed as an id.
  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.id, id);
  }
}
