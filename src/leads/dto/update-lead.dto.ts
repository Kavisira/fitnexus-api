import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'TRIAL_SCHEDULED', 'TRIAL_COMPLETED', 'CONVERTED', 'LOST'] as const;

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  interestedPlan?: string;

  // Real Employee id — validated (exists, belongs to this org) in the
  // service, same pattern as branchId. Accepts null to clear the
  // assignment.
  @IsOptional()
  @IsString()
  assignedToEmployeeId?: string | null;

  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  // Required by the service (not here) when status is being set to LOST.
  // Accepts null so "reopening" a concluded lead can explicitly clear it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lostReason?: string | null;

  // Required by the service (not here) when status is being set to
  // CONVERTED via the "Conclude" checkbox. Accepts null for the same
  // reopen-and-clear reason as lostReason above.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  concludeComment?: string | null;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;
}
