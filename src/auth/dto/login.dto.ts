import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Accepts either the email or phone the user registered with — the
  // Angular login form has a single "email or phone number" field.
  @IsString()
  identifier!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  // "Remember me" — when true the issued JWT lives for 30 days instead
  // of the default 30-minute session.
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
