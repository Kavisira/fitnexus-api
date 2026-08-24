import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// Written out explicitly (rather than @nestjs/mapped-types' PartialType)
// to avoid adding a new dependency for one DTO — every field is simply
// optional here since this is a partial update.
export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent?: number;

  @IsOptional()
  @IsIn(['en', 'ta'])
  defaultLanguage?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsBoolean()
  isMainBranch?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  memberCount?: number;
}
