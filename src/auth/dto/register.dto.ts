import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

// Mirrors the Angular Register form (owner name, organization name,
// phone, email, password) and its password rule exactly: at least 6
// characters, one uppercase, one lowercase, one number.
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

export class RegisterDto {
  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsString()
  @MinLength(2)
  organizationName!: string;

  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number (with country code)' })
  phone!: string;

  @IsEmail()
  email!: string;

  @Matches(STRONG_PASSWORD, {
    message: 'password must be at least 6 characters and include an uppercase letter, a lowercase letter, and a number',
  })
  password!: string;
}
