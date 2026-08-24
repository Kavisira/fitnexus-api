import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateBranchDto {
  // The branch's identifying field — a short single-line label for
  // where it is ("Anna Nagar, Chennai"). Mandatory and unique per
  // organization; there is no separate name field. Full free-text
  // detail belongs in address below, not here.
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  location!: string;

  // Extra free-text detail (full address, landmark, floor/unit,
  // directions, etc.) — a multi-line field, fully separate from
  // location, always optional.
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

  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent!: number;

  @IsOptional()
  @IsIn(['en', 'ta'])
  defaultLanguage?: string;

  // Ignored server-side for an organization's very first branch — it's
  // always made main automatically. Only takes effect from the second
  // branch onward (see BranchesService.create).
  @IsOptional()
  @IsBoolean()
  isMainBranch?: boolean;

  @IsInt()
  @Min(0)
  memberCount!: number;
}
