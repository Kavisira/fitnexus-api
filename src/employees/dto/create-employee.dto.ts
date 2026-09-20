import { IsArray, IsBoolean, IsDateString, IsEmail, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SalaryComponentDto } from './salary-component.dto';

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

  // Free-form job title — matched against (or added to) this org's
  // managed job title list; see EmployeesService.ensureJobTitle.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  role?: string;

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

  // Full replace-set on every save (see EmployeesService.replaceSalaryComponents)
  // — omit entirely to leave the employee with no components, don't
  // try to send a partial diff.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
