import { PunchPersonType } from '@prisma/client';
import { IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpsertEnrollmentDto {
  @IsString()
  @MinLength(1)
  biometricUserId!: string;

  @IsEnum(PunchPersonType)
  personType!: PunchPersonType;

  @ValidateIf((o) => o.personType === PunchPersonType.EMPLOYEE)
  @IsString()
  @MinLength(1)
  employeeId?: string;

  @ValidateIf((o) => o.personType === PunchPersonType.MEMBER)
  @IsString()
  @MinLength(1)
  memberId?: string;
}
