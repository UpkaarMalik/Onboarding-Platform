import { ArrayUnique, IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOnboardingDto {
  @IsUUID()
  userId!: string;

  /** Date of joining. */
  @IsDateString()
  startDate!: string;

  // Free text, matching the create form's plain inputs. Optional so the
  // pre-existing POST /onboardings callers and the e2e suite keep
  // working without supplying them.
  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsString()
  buddyName?: string;

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
