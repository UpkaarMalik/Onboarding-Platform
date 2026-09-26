import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
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

  // Must be declared before :userId so NestJS does not treat "search" as a UUID.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('search')
  search(@Query('q') q: string) {
    return this.employeeProfile.search(q ?? '');
  }

  /**
   * The caller's own profile.
   *
   * No @Roles: everyone signed in has one, and the record returned is
   * chosen by the token rather than by anything the caller sends — there
   * is no id to tamper with, so a role check would add nothing. Same
   * shape HR sees, because it is the same person's data.
   *
   * Declared above :userId for the same reason 'search' is: otherwise
   * ParseUUIDPipe rejects the literal "me".
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getOwnProfile(@CurrentUser() actor: AuthenticatedUser) {
    return this.employeeProfile.getProfile(actor.id);
  }

  /**
   * The caller editing their own contact details.
   *
   * Deliberately NOT the surface HR gets. Only phone and personal email
   * are forwarded; department, joining date and status stay HR's, and are
   * dropped here rather than filtered further down — so adding a field to
   * the HR body below can never quietly widen what someone may change
   * about themselves.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateOwnProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { phoneNumber?: unknown; personalEmail?: unknown },
  ) {
    return this.employeeProfile.updateProfile(
      actor.id,
      { phoneNumber: body?.phoneNumber, personalEmail: body?.personalEmail },
      actor.id,
    );
  }

  // HR-only, and a fixed role rather than a data-dependent check: this
  // is the whole-company view by definition, so there is no "your own
  // profile" case for RolesGuard to be too blunt for.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get(':userId')
  getProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.employeeProfile.getProfile(userId);
  }

  /** Update core joinee details: phone, personal email, department, joining date. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Patch(':userId')
  updateProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: {
      phoneNumber?: unknown;
      personalEmail?: unknown;
      departmentId?: unknown;
      startDate?: unknown;
    },
  ) {
    return this.employeeProfile.updateProfile(userId, body, actor.id);
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
