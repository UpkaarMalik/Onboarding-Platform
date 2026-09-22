import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BlockersService } from './blockers.service';
import { ResolveBlockerDto } from './dto/resolve-blocker.dto';

/**
 * Resolving is addressed by BLOCKER id, not task id — a task can be
 * blocked, resolved and blocked again, so "resolve the blocker on this
 * task" would be ambiguous the moment there is history.
 *
 * No @Roles(): who may resolve is HR *or* this specific task's owner,
 * which depends on the row rather than on the caller's role alone, and
 * RolesGuard cannot express that. BlockersService.assertMayActOnTask
 * is the check — same placement as the completion endpoints next door.
 */
@Controller('blockers')
export class BlockersController {
  constructor(private readonly blockersService: BlockersService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':id/resolve')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveBlockerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.blockersService.resolve(id, user, dto);
  }
}
