import { ArrayUnique, IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateOnboardingDto {
  @IsUUID()
  userId!: string;

  /** Date of joining. */
  @IsDateString()
  startDate!: string;

  // Picked from GET /onboardings/eligible-people — someone whose own
  // onboarding is completed. Optional (see docs/decisions/002).
  @IsOptional()
  @IsUUID()
  managerUserId?: string;

  @IsOptional()
  @IsUUID()
  buddyUserId?: string;

  /**
   * Document types the joinee must upload, from the Documents step's
   * checkbox grid. Each one becomes a joinee_document_requirements row
   * plus, collectively, a single gating task on the onboarding.
   *
   * Omitting it (or passing an empty array) creates no document task at
   * all, which is what the existing callers do.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  requiredDocumentTypeIds?: string[];
}
