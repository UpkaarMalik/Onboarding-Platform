import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './tokens/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PreAuthGuard } from './guards/pre-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { SessionsService } from './sessions/sessions.service';

@Module({
  imports: [
    UsersModule,
    ActivityLogModule,
    DatabaseModule,
    PassportModule,
    // No default secret/expiry registered here on purpose — TokenService
    // passes secret + expiresIn explicitly per call, since access and
    // pre-auth tokens each need their own.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionsService,
    JwtStrategy,
    PreAuthGuard,
    RefreshGuard,
    JwtAuthGuard,
    RolesGuard,
    // CSRF check runs globally on every state-changing request. Login
    // endpoints opt out with @SkipCsrf() because there's no CSRF cookie
    // to check against on the request that MINTS one.
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
  exports: [AuthService, TokenService, JwtAuthGuard, RolesGuard, SessionsService],
})
export class AuthModule {}
