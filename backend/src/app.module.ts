import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER } from '@nestjs/core';
import { DepartmentsModule } from './departments/departments.module';

import { DatabaseModule } from './database/database.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingsModule } from './onboardings/onboardings.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
// PARKED-FEATURE: community
// import { CommunityModule } from './community/community.module';
import { DocumentsModule } from './documents/documents.module';
import { JoineeDocumentsModule } from './joinee-documents/joinee-documents.module';
import { EmployeeProfileModule } from './employee-profile/employee-profile.module';
import { NotificationsModule } from './notifications/notifications.module';
// PARKED-FEATURE: diary
// import { DiaryModule } from './diary/diary.module';

import { AllExceptionsFilter } from './common/all-exceptions.filter';

/**
 * What the login rate limiter counts against: the Joinee ID being tried,
 * not the address trying it.
 *
 * The address is the obvious key and it is the wrong one here. Everyone
 * in an office shares one public IP, so an IP budget is a budget for the
 * whole building — one colleague mistyping their password five times in
 * a row locks out everybody else, including people whose password is
 * correct, because the guard refuses the request before it ever looks at
 * the credentials. Keying on the account means a wrong password can only
 * ever slow down the account it was wrong for.
 *
 * Normalised before it becomes a key. Joinee IDs are generated uppercase
 * (see generate_joinee_id() in migration 0015) and the sign-in form
 * upper-cases as you type, but a scripted caller is under no such
 * obligation: without this, 'jn-2026-001' and 'JN-2026-001' are two
 * buckets for one account and the limit is bypassed by holding shift.
 * Truncated because this is unvalidated request input — the DTO has not
 * run yet at guard time.
 *
 * The fallbacks matter for /complete-reset, whose body carries a new
 * password and no Joinee ID. Its pre-auth token identifies exactly one
 * user, so it serves as the account key there; the address is the last
 * resort, for a request so malformed it has neither.
 *
 * ponytail: distinct IDs mint distinct buckets, and the in-memory store
 * drops a bucket's hit count on a timer but never removes the bucket, so
 * a caller cycling through invented IDs grows the map until the process
 * restarts. Bounded in practice by how fast one caller can cycle; the
 * upgrade is the Redis storage adapter, which expires keys for real.
 */
function trackByJoineeId(req: Record<string, any>): string {
  const raw = req.body?.joineeId;
  const joineeId = typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 64) : '';
  return joineeId || req.headers?.authorization || req.ip || 'unknown';
}

@Module({
  imports: [
    // Loads .env once, makes it available everywhere via ConfigService
    // (no need to re-import ConfigModule in every feature module).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Deliberately NOT registered as an APP_GUARD: the only routes that
    // need a limit are the two login endpoints, which mount
    // ThrottlerGuard themselves (see AuthController). A global guard
    // would also meter the activity-log SSE stream and the /auth/me
    // heartbeat, both of which are supposed to be chatty.
    //
    // ttl is MILLISECONDS in throttler v5 — it was seconds in v4, and
    // 30 here would mean a 30ms window that never blocks anything.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 30_000,
          limit: 10,
          getTracker: trackByJoineeId,
        },
      ],
      // Replaces "ThrottlerException: Too Many Requests", which names a
      // class the caller has no reason to know about. AllExceptionsFilter
      // maps the 429 to code TOO_MANY_REQUESTS like every other status.
      //
      // 30 seconds is the full window and therefore the worst case; the
      // window slides, so the login form shows the real remaining time
      // from Retry-After rather than repeating this number.
      errorMessage: 'Too many attempts. Try again in 30 seconds.',
    }),

    DatabaseModule,
    DepartmentsModule,
    ActivityLogModule,
    TemplatesModule,
    UsersModule,
    AuthModule,
    OnboardingsModule,
    KnowledgeModule,
    EntitlementsModule,
    DocumentsModule,
    JoineeDocumentsModule,
    EmployeeProfileModule,
    NotificationsModule,
    // PARKED-FEATURE: diary, community. Un-registering the modules is
    // all it takes — Nest never maps their controllers, so /diary and
    // /community/* now 404. The module, controller and service files
    // are untouched on disk, as are their tables and the rows in them.
    // CommunityModule,
    // DiaryModule,

    // Remaining feature modules get added here as later steps build them.
  ],

  providers: [
    // Step 34:
    // Register the exception filter through APP_FILTER so it works
    // both when the application starts normally through main.ts and
    // when e2e tests create the application through AppModule.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}

