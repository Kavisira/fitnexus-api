import { IsIn, IsNumberString, IsString, MaxLength, MinLength } from 'class-validator';

export const SALARY_COMPONENT_TYPES = ['EARNING', 'DEDUCTION'] as const;

/** One line of an employee's salary structure, as sent from the
 * Employees form's editable component list (see employees.ts). Always
 * a percentage of basicPay — see the SalaryComponent model comment. */
export class SalaryComponentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsIn(SALARY_COMPONENT_TYPES)
  type!: (typeof SALARY_COMPONENT_TYPES)[number];

  // Plain numeric string (e.g. "12.5") — Prisma stores it as Decimal;
  // the service converts. Range is enforced in the service (0-100)
  // since class-validator's numeric decorators don't check bounds.
  @IsNumberString()
  percent!: string;
}
