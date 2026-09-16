import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { EmployeeProfileService } from './employee-profile.service';

@Controller('employee-profile')
export class EmployeeProfileController {
  constructor(private readonly employeeProfile: EmployeeProfileService) {}

  // HR-only, and a fixed role rather than a data-dependent check: this
  // is the whole-company view by definition, so there is no "your own
  // profile" case for RolesGuard to be too blunt for.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get(':userId')
  getProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.employeeProfile.getProfile(userId);
  }

  /** Suspend or restore sign-in for one joinee. Body: { enabled: boolean }. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Patch(':userId/status')
  setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { enabled?: unknown },
  ) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException("'enabled' must be a boolean");
    }
    return this.employeeProfile.setUserEnabled(userId, body.enabled, actor.id);
  }
}
