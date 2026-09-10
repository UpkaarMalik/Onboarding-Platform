import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
  PasswordLoginDto,
  RequestOtpDto,
  OtpCodeDto,
  CompletePasswordResetDto,
} from './dto/login.dto';
import { PreAuthGuard } from './guards/pre-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { PreAuthUser, PreAuthContext } from './decorators/pre-auth-user.decorator';
import { RefreshUser } from './decorators/refresh-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users')
  createUser(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.authService.createUser(dto, actor.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users/:id/regenerate-credentials')
  regenerateCredentials(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.regenerateCredentials(id, actor.id);
  }

  // Reopening the credentials popup. Returns the Joinee ID but never the
  // temporary password — see getCredentialsSummary for why that isn't a
  // limitation worth working around.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('users/:id/credentials')
  getCredentials(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.getCredentialsSummary(id, actor.id);
  }

  // ============================================================
  // Method 1 — Joinee ID + password. Complete on its own, unless the
  // password is still the HR-issued temp one, in which case a
  // password-reset pre-auth token is returned instead of real tokens.
  // ============================================================

  @Post('login/password')
  loginWithPassword(@Body() dto: PasswordLoginDto) {
    return this.authService.loginWithPassword(dto.joineeId, dto.password);
  }

  @UseGuards(PreAuthGuard)
  @Post('login/password/complete-reset')
  completePasswordReset(
    @PreAuthUser() ctx: PreAuthContext,
    @Body() dto: CompletePasswordResetDto,
  ) {
    this.assertPurpose(ctx, 'password_reset');
    return this.authService.completePasswordReset(ctx.userId, dto.newPassword);
  }

  // ============================================================
  // Method 2 — mobile number + OTP. No password involved at all.
  // ============================================================

  @Post('login/otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestMobileOtp(dto.phoneNumber);
  }

  @UseGuards(PreAuthGuard)
  @Post('login/otp/verify')
  verifyOtp(@PreAuthUser() ctx: PreAuthContext, @Body() dto: OtpCodeDto) {
    this.assertPurpose(ctx, 'otp_login');
    return this.authService.verifyMobileOtp(ctx.userId, dto.code);
  }

  @UseGuards(PreAuthGuard)
  @Post('login/otp/resend')
  resendOtp(@PreAuthUser() ctx: PreAuthContext) {
    this.assertPurpose(ctx, 'otp_login');
    return this.authService.resendMobileOtp(ctx.userId);
  }

  /** A password-reset pre-auth token and an otp-login pre-auth token
   *  are minted for entirely different endpoints — this stops one
   *  from being replayed against the other even though both are the
   *  same JWT type/secret. */
  private assertPurpose(ctx: PreAuthContext, purpose: PreAuthContext['purpose']) {
    if (ctx.purpose !== purpose) {
      throw new UnauthorizedException('Invalid token for this operation');
    }
  }

  // --- Token refresh ---
  @UseGuards(RefreshGuard)
  @Post('refresh')
  refresh(@RefreshUser() userId: string) {
    return this.authService.refreshAccessToken(userId);
  }
}
