import { IsString, Length } from 'class-validator';

/** Joinee ID + password — the only login method. A complete login on
 *  its own, unless the password is still the HR-issued temp one (see
 *  AuthService.loginWithPassword). */
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

// userId is intentionally NOT a field on CompletePasswordResetDto — it
// comes from the verified pre-auth token via @PreAuthUser(), attached
// by PreAuthGuard.

// OTP-LOGIN-DISABLED — mobile number + OTP, no password involved at all.
//
// export class RequestOtpDto {
//   @IsString()
//   phoneNumber!: string;
// }
//
// export class OtpCodeDto {
//   @IsString()
//   @Length(6, 6)
//   code!: string;
// }
