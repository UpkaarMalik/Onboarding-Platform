import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TemplatesModule } from '../templates/templates.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { OnboardingTasksController } from './onboarding-tasks.controller';
import { OnboardingTasksService } from './onboarding-tasks.service';
import { BlockersController } from './blockers.controller';
import { BlockersService } from './blockers.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    TemplatesModule,
    ActivityLogModule,
    NotificationsModule,
  ],
  controllers: [
    OnboardingsController,
    OnboardingTasksController,
    BlockersController,
  ],
  providers: [
    OnboardingsService,
    OnboardingTasksService,
    BlockersService,
  ],
  exports: [
    OnboardingsService,
    OnboardingTasksService,
  ],
})
export class OnboardingsModule {}
