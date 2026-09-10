import { IsString, Length } from 'class-validator';

/** Method 1: Joinee ID + password. No company email, no OTP — a
 *  complete login on its own, unless the password is still the
 *  HR-issued temp one (see AuthService.loginWithPassword). */
export class PasswordLoginDto {
  @IsString()
  joineeId!: string;

  @IsString()
  password!: string;
}

export class CompletePasswordResetDto {
  @IsString()
  @Length(8, 100)
  newPassword!: string;
}

/** Method 2: mobile number + OTP. No password involved at all. */
export class RequestOtpDto {
  @IsString()
  phoneNumber!: string;
}

// userId is intentionally NOT a field on either OtpCodeDto or
// CompletePasswordResetDto — it comes from the verified pre-auth token
// via @PreAuthUser(), attached by PreAuthGuard.

export class OtpCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
