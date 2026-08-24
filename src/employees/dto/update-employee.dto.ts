import { IsDateString, IsEmail, IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EMPLOYEE_ROLES } from './create-employee.dto';

const EMPLOYMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class UpdateEmployeeDto {
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
  @IsIn(EMPLOYEE_ROLES)
  role?: (typeof EMPLOYEE_ROLES)[number];

  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  status?: (typeof EMPLOYMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  joinDate?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  photoUrl?: string | null;

  @IsOptional()
  @IsNumberString()
  basicPay?: string | null;
}
