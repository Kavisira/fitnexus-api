import { IsIn, IsNumber, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

const PLAN_DURATIONS = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CLASS_PACK', 'DROP_IN'] as const;

// Every field optional — this is a partial update, written out explicitly
// rather than @nestjs/mapped-types' PartialType (same call as
// UpdateBranchDto/UpdateLeadDto).
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsIn(PLAN_DURATIONS)
  duration?: (typeof PLAN_DURATIONS)[number];
}
