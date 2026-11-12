import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { PlatformExpenseCategory, PlatformExpenseFrequency } from '@prisma/client';

export class CreatePlatformExpenseDto {
  @IsEnum(PlatformExpenseCategory)
  category!: PlatformExpenseCategory;

  @IsString()
  @MinLength(2)
  label!: string;

  @IsNumber()
  @IsPositive()
  amountInr!: number;

  @IsEnum(PlatformExpenseFrequency)
  frequency!: PlatformExpenseFrequency;

  @IsDateString()
  incurredAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePlatformExpenseDto extends CreatePlatformExpenseDto {}
