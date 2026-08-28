import { IsIn, IsNumber, IsString, Min, MaxLength, MinLength } from 'class-validator';

const PLAN_DURATIONS = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CLASS_PACK', 'DROP_IN'] as const;

export class CreatePlanDto {
  // Which branch this plan belongs to — mandatory, validated against the
  // caller's own organization in the service (same pattern as
  // CreateLeadDto.branchId / CreateEmployeeDto.branchId).
  @IsString()
  branchId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  // No currency field — always displayed/entered in the owning branch's
  // currency (Branch.currency), same as how tax rate is branch-wise.
  @IsNumber()
  @Min(0)
  price!: number;

  @IsIn(PLAN_DURATIONS)
  duration!: (typeof PLAN_DURATIONS)[number];
}
