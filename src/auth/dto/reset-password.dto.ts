import { IsString, Length, Matches } from 'class-validator';

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;

export class ResetPasswordDto {
  @IsString()
  identifier!: string;

  @Length(6, 6)
  otp!: string;

  @Matches(STRONG_PASSWORD, {
    message: 'newPassword must be at least 6 characters and include an uppercase letter, a lowercase letter, and a number',
  })
  newPassword!: string;
}
