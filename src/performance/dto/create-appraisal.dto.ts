import { IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateAppraisalDto {
  @IsString()
  employeeId!: string;

  @IsDateString()
  effectiveDate!: string;

  @IsNumberString()
  newBasicPay!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
