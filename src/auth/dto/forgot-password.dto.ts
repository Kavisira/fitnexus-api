import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  identifier!: string; // email or phone
}
