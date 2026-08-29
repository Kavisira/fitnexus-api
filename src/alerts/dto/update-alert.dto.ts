import { AlertAudienceType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

// Every field optional — this is a partial update, written out
// explicitly rather than @nestjs/mapped-types' PartialType (not a
// dependency of this project — see the other update-*.dto.ts files).
export class UpdateAlertDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(AlertAudienceType)
  audienceType?: AlertAudienceType;

  @ValidateIf((dto) => dto.audienceType === AlertAudienceType.BRANCH)
  @IsString()
  @MinLength(1)
  audienceBranchId?: string;

  @ValidateIf((dto) => dto.audienceType === AlertAudienceType.USER)
  @IsString()
  @MinLength(1)
  audienceUserId?: string;
}
