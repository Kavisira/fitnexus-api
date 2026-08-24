import { IsString, Length } from 'class-validator';

export class VerifyResetOtpDto {
  @IsString()
  identifier!: string;

  @Length(6, 6)
  otp!: string;
}
