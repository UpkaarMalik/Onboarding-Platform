import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { EmployeeProfileController } from './employee-profile.controller';
import { EmployeeProfileService } from './employee-profile.service';

// AuthModule only — DatabaseModule is @Global(), and this module reads
// its own SQL rather than depending on Users/Onboardings/JoineeDocuments
// (which would form an import cycle, see EmployeeProfileService).
@Module({
  imports: [AuthModule, ActivityLogModule],
  controllers: [EmployeeProfileController],
  providers: [EmployeeProfileService],
})
export class EmployeeProfileModule {}
