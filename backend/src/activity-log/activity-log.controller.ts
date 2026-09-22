import { Controller, Get, Query, Sse, UseGuards } from '@nestjs/common';
import { Observable, map, merge, startWith, throttleTime } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  assertOnlyAllowedKeys,
  assertUuidIfPresent,
  parsePagination,
} from '../common/list-query.util';
import { ActivityLogService } from './activity-log.service';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  /**
   * "Something changed" as a server-sent event stream, so HR's activity
   * feed updates the moment it happens instead of on its next poll.
   *
   * Only a ping is sent, never the events themselves. The client re-reads
   * GET /activity-logs when it gets one, which keeps exactly one code path
   * producing the rows — same filters, same name resolution, same role
   * check — instead of a second, subtly different one that exists only on
   * this socket.
   *
   * throttleTime with trailing so a burst of writes (creating a joinee
   * writes several rows in one transaction) is one ping plus one at the
   * end, not one per row. leading:true is what makes the first one
   * immediate, which is the whole point.
   *
   * startWith fires a ping on connect, so a client that missed events
   * while it was away is current straight away rather than after the
   * first new write.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Sse('stream')
  stream(): Observable<{ data: string }> {
    return merge(
      this.activityLogService.onWritten().pipe(
        throttleTime(250, undefined, { leading: true, trailing: true }),
      ),
    ).pipe(
      startWith(undefined),
      map(() => ({ data: 'changed' })),
    );
  }

  // Declared before @Get() so 'entity-types' isn't swallowed as a param.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('entity-types')
  entityTypes() {
    return this.activityLogService.listEntityTypes();
  }

  // Only SuperAdmin/HR read the audit trail.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get()
  list(
    @Query()
    query: {
      entityType?: string;
      entityId?: string;
      search?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    assertOnlyAllowedKeys(query, ['entityType', 'entityId', 'search', 'limit', 'offset']);
    assertUuidIfPresent(query.entityId, 'entityId');
    // entityType is deliberately NOT allow-listed against a fixed set:
    // it's whatever string a log() call site passed, so a new module
    // adding a new entity type must stay filterable without editing
    // this file. It's a bound parameter, never interpolated.
    return this.activityLogService.listLogs(
      { entityType: query.entityType, entityId: query.entityId, search: query.search },
      parsePagination(query),
    );
  }
}
