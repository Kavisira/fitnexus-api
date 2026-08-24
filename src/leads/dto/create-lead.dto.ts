import { IsDateString, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Which branch this lead is interested in — mandatory, validated
  // against the caller's own organization in the service.
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  interestedPlan?: string;

  // Real Employee id — validated (exists, belongs to this org) in the
  // service, same pattern as branchId.
  @IsOptional()
  @IsString()
  assignedToEmployeeId?: string;

  // Always created as NEW server-side — status isn't accepted on create.
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}
