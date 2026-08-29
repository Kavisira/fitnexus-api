import { LeaveType, UserRole } from '@prisma/client';
import { IsEnum, IsNumber, Min } from 'class-validator';

export class UpsertAllocationConfigDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsEnum(LeaveType)
  leaveType!: LeaveType;

  @IsNumber()
  @Min(0)
  monthlyAllocation!: number;

  @IsNumber()
  @Min(0)
  carryForwardCap!: number;
}
