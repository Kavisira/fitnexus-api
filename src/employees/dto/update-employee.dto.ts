import { IsArray, IsDateString, IsEmail, IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SalaryComponentDto } from './salary-component.dto';

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
  @IsString()
  @MaxLength(60)
  role?: string;

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

  // Full replace-set on every save (see EmployeesService.replaceSalaryComponents)
  // — omit the field entirely to leave the existing components
  // untouched; send an empty array to clear them all.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
