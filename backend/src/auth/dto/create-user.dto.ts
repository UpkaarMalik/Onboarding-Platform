import { IsEmail, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsString()
  fullName!: string;

  /** Doubles as the mobile+OTP login identifier — normalized to digits
   *  only on write (UsersService) and unique across live accounts. */
  @IsString()
  phoneNumber!: string;

  /**
   * The joinee's own address, where the Joinee ID and temporary password
   * will be emailed once that flow exists. Recorded now, deliberately
   * not sent to — HR hands the credentials over directly today.
   *
   * Optional at this boundary rather than required: the two seeded
   * superadmins predate the column, and nothing should have to
   * back-fill them to keep working.
   */
  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsIn(['superadmin_hr', 'task_owner', 'employee'])
  role!: 'superadmin_hr' | 'task_owner' | 'employee';

  // Required for employees (drives their onboarding's department),
  // optional for SuperAdmin/HR/TaskOwner accounts.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
