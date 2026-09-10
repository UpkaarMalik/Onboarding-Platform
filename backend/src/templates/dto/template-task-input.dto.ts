import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateSubtaskInputDto } from './template-subtask-input.dto';

export class TemplateTaskInputDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  ownerRole!: string;

  @IsInt()
  @Min(0)
  dueOffsetDays!: number;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /** Employee-only — see migration 0028. Authoring a template with
   *  'owner' or 'dual' would put tasks on a joinee's list that they
   *  have no way to close. */
  @IsIn(['employee'])
  completionMode!: 'employee';

  @IsOptional()
  @IsBoolean()
  isCheckpoint?: boolean;

  @IsOptional()
  @IsString()
  milestone?: string;

  /** The checklist shown when the employee opens this task. Omit or
   *  leave empty for a task that completes in one action with no popup
   *  checklist — the pre-subtask behaviour, unchanged.
   *
   *  @Type is required for ValidateNested to run at all: the global
   *  ValidationPipe uses forbidNonWhitelisted, and without the explicit
   *  type these arrive as plain objects and every nested rule is
   *  silently skipped. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSubtaskInputDto)
  subtasks?: TemplateSubtaskInputDto[];
}
