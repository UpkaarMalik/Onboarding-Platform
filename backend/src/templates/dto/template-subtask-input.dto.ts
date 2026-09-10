import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * One checkbox inside a major task's popup. Deliberately far leaner than
 * TemplateTaskInputDto: no owner role, due offset, priority, completion
 * mode or checkpoint flag. All of that belongs to the major task that
 * owns the subtask — duplicating it here would mean two parallel task
 * state machines to keep in sync.
 *
 * display_order is not an input: it's assigned from array position when
 * the template is written, so the popup renders in the order HR authored.
 */
export class TemplateSubtaskInputDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** An optional subtask never holds its parent task open — see
   *  OnboardingSubtasksService.markDone. */
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
