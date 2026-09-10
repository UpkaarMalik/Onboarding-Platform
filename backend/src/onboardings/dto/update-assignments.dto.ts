import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Manager and buddy after the fact. Both are optional at creation — HR
 * often doesn't know who the buddy is on day one — so this is how they
 * get filled in later, and how a wrong one gets corrected.
 *
 * Passing an empty string clears the field: '' is a deliberate "remove
 * this", distinct from omitting the key, which leaves it untouched. That
 * distinction is what lets one endpoint set either field independently
 * without a separate clear route.
 */
export class UpdateAssignmentsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  managerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  buddyName?: string;
}
