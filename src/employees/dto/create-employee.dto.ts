import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const EMPLOYEE_ROLES = ['MANAGER', 'TRAINER', 'FRONT_DESK', 'OTHER'] as const;

export class CreateEmployeeDto {
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

  // Single branch only — mandatory, validated against the caller's own
  // organization in the service (same pattern as Lead.branchId).
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  role?: (typeof EMPLOYEE_ROLES)[number];

  @IsString()
  joinDate!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  // Plain numeric string (e.g. "35000.00") — kept as a string DTO-side
  // since Prisma stores it as Decimal; the service converts.
  @IsOptional()
  @IsNumberString()
  basicPay?: string;

  // When true, a staff login (username/password auto-generated from
  // name + DOB + org name, and phone) is created alongside the employee
  // — see EmployeesService.create. The service enforces dateOfBirth is
  // present when this is set, since the username depends on it.
  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;
}
