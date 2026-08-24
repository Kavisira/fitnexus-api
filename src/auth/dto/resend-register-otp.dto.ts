import { IsEmail } from 'class-validator';

export class ResendRegisterOtpDto {
  @IsEmail()
  email!: string;
}
