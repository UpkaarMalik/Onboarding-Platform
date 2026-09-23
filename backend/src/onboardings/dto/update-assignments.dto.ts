import { IsOptional, IsUUID } from 'class-validator';

/**
 * Manager and buddy after the fact. Both are optional at creation — HR
 * often doesn't know who the buddy is on day one — so this is how they
 * get filled in later, and how a wrong one gets corrected.
 *
 * Each is a user id picked from GET /onboardings/eligible-people. null
 * clears it; omitting the key leaves it untouched. That distinction is
 * what lets one endpoint set either field independently without a
 * separate clear route. (@IsOptional lets null through to the service.)
 */
export class UpdateAssignmentsDto {
  @IsOptional()
  @IsUUID()
  managerUserId?: string | null;

  @IsOptional()
  @IsUUID()
  buddyUserId?: string | null;
}
