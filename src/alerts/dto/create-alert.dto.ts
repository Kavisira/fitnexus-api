import { AlertAudienceType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateAlertDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(AlertAudienceType)
  audienceType?: AlertAudienceType;

  @ValidateIf((dto) => dto.audienceType === AlertAudienceType.BRANCH)
  @IsString()
  @IsNotEmpty()
  audienceBranchId?: string;

  @ValidateIf((dto) => dto.audienceType === AlertAudienceType.USER)
  @IsString()
  @IsNotEmpty()
  audienceUserId?: string;
}
