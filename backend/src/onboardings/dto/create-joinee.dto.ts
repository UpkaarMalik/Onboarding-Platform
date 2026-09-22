import { ArrayUnique, IsArray, IsDateString, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Everything the create-joinee wizard collects, in one payload.
 *
 * The union of CreateUserDto's fields and CreateOnboardingDto's, minus
 * `userId` (there is no user yet — that is the point) and minus `role`,
 * which is always 'employee' here: this endpoint exists to onboard a
 * joinee, and an onboarding can only be built for an employee account
 * anyway. HR creates a task owner through POST /auth/users.
 */
export class CreateJoineeDto {
  @IsString()
  fullName!: string;

  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsUUID()
  departmentId!: string;

  /** Date of joining. */
  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsString()
  buddyName?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  requiredDocumentTypeIds?: string[];
}
