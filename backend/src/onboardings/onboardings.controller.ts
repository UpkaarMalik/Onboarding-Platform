import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingsService } from './onboardings.service';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { CreateJoineeDto } from './dto/create-joinee.dto';
import { ProvisionCompanyEmailDto } from './dto/provision-company-email.dto';
import { CreateAdHocTaskDto } from './dto/create-ad-hoc-task.dto';
import { UpdateAssignmentsDto } from './dto/update-assignments.dto';

@Controller('onboardings')
export class OnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  // Only SuperAdmin/HR add joiners — same privilege level as creating
  // the user account in the first place (AuthController.createUser).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.createOnboarding(dto, actor.id);
  }

  // Same privilege level: HR recording the company email is what
  // starts the pre_onboarding -> email_provisioned transition.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post(':id/provision-email')
  provisionEmail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionCompanyEmailDto,
  ) {
    return this.onboardingsService.provisionCompanyEmail(id, dto, actor.id);
  }

  // HR/SuperAdmin dashboard: every onboarding, company-wide. Step 32:
  // allow-listed filters (department/status/health/dateFrom/dateTo)
  // and sort (name/startDate/progress) — @Query() with no key captures
  // the FULL query object so the service can reject any key outside
  // that list, not just read the ones it recognizes.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get()
  listAll(@Query() query: Record<string, string | undefined>) {
    return this.onboardingsService.listAllOnboardings(query);
  }

  // Step 28: CSV export, same allow-listed filters as listAll() minus
  // sort (Step 32). Notes are structurally absent from this query
  // (OnboardingsService.exportOnboardingsCsv never joins that table) —
  // not filtered out.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="onboardings-export.csv"')
  @Get('export')
  export(@Query() query: Record<string, string | undefined>) {
    return this.onboardingsService.exportOnboardingsCsv(query);
  }

  // Step 26: the single-screen "what's stuck" view (BRD M6). One row
  // per required task that's either blocked or overdue (Step 25's
  // shared isOverdueSql(), which excludes locked tasks so a checkpoint
  // waiting on confirmation shows up once, not as a flood of its
  // blocked-behind-it phase-2 tasks) on an onboarding that isn't
  // finished yet. Step 32: allow-listed department/owner/priority
  // filters, dueDate/priority sort.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('stuck')
  listStuck(@Query() query: Record<string, string | undefined>) {
    return this.onboardingsService.listStuckTasks(query);
  }

  /**
   * Account + onboarding in one all-or-nothing request, returning the
   * one-time login credentials.
   *
   * The wizard used to make two calls and could strand a half-made person
   * in the system when the second failed. The old endpoints stay for now;
   * this is the one the wizard uses.
   */
  // The manager/buddy dropdowns' options. Declared before any ':id' route.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('eligible-people')
  eligiblePeople() {
    return this.onboardingsService.listEligiblePeople();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('joinee')
  createJoinee(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateJoineeDto) {
    return this.onboardingsService.createJoinee(dto, actor.id);
  }

  // Declared before ':id/tasks' for the same reason 'ratings' is —
  // a literal segment must not be readable as a uuid param.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('summary')
  getSummary() {
    return this.onboardingsService.getSummary();
  }

  // Step 21: Employee dashboard. Scoped server-side to the caller's
  // own onboarding (OnboardingsService.findByUserId(actor.id)) — never
  // an id from the URL or query string, so there's no path to another
  // employee's onboarding here at all, not even a hidden one.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('employee')
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingsService.getMyDashboard(user);
  }

  // The task scheduler: HR adding a one-off task onto a specific
  // onboarding, and viewing that onboarding's full task list
  // (every status, not just what the employee's own dashboard
  // surfaces). Completion itself still only happens through the
  // employee/task_owner endpoints on OnboardingTasksController.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post(':id/tasks')
  scheduleTask(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAdHocTaskDto,
  ) {
    return this.onboardingsService.createAdHocTask(id, dto, actor.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get(':id/tasks')
  getTasks(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboardingsService.getOnboardingTasks(id);
  }

  // Manager and buddy are optional when the joinee is created, so this
  // is how they get added afterwards — or corrected.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Patch(':id/assignments')
  updateAssignments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentsDto,
  ) {
    return this.onboardingsService.updateAssignments(id, dto, actor.id);
  }
}
