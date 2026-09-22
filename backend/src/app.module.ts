import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
// PARKED-FEATURE: diary
// import { DiaryModule } from './diary/diary.module';

import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [
    // Loads .env once, makes it available everywhere via ConfigService
    // (no need to re-import ConfigModule in every feature module).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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

