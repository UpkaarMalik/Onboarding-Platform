import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * "Mark as blocked". The reason is the whole point of the feature — a
 * blocker without one is just the 'blocked' status we already had and
 * nobody could act on, so it is required and cannot be whitespace.
 *
 * ownerRole/ownerUserId are optional overrides. Omitted, the blocker
 * inherits the task's own owner, which is right the overwhelming
 * majority of the time ("the laptop task is IT's, so the laptop
 * blocker is IT's"). They exist for the case where the task's owner is
 * not the one who has to unstick it — a task owned by the reporting
 * manager that is actually waiting on Facilities.
 */
export class CreateBlockerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  /** A date, not a timestamp — "expected Wednesday" is the granularity
   *  anyone commits to. Omit it when nobody would be guessing honestly. */
  @IsOptional()
  @IsDateString()
  expectedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ownerRole?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}
