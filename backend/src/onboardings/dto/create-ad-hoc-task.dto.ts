import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/** HR scheduling a one-off task onto an existing onboarding — the
 *  "task scheduler", distinct from the fixed tasks a template
 *  snapshots in at OnboardingsService.createOnboarding time. Never
 *  a checkpoint (is_checkpoint is always false here; there's exactly
 *  one checkpoint per onboarding and it comes from the template). */
export class CreateAdHocTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(['employee', 'task_owner'])
  ownerRole!: 'employee' | 'task_owner';

  @IsDateString()
  dueDate!: string;

  @IsIn(['low', 'normal', 'high'])
  priority!: 'low' | 'normal' | 'high';

  /** Employee-only. 'owner' and 'dual' were removed in migration 0028:
   *  every task is closed by the employee alone, so accepting either
   *  here would quietly reintroduce a task they cannot complete. */
  @IsIn(['employee'])
  completionMode!: 'employee';

  @IsBoolean()
  isRequired!: boolean;
}
