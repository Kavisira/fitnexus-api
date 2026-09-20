import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GeneratePayrollDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  // Optional: generate for one branch only. Omit to run org-wide.
  @IsOptional()
  @IsString()
  branchId?: string;
}
