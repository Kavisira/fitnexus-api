import { IsEmail, Length } from 'class-validator';

export class VerifyRegisterOtpDto {
  @IsEmail()
  email!: string;

  @Length(6, 6)
  emailOtp!: string;

  @Length(6, 6)
  phoneOtp!: string;
}
