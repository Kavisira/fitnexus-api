import { PunchDirection } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class GenericPunchEventDto {
  @IsString()
  @MinLength(1)
  biometricUserId!: string;

  @IsDateString()
  timestamp!: string;

  @IsOptional()
  @IsEnum(PunchDirection)
  direction?: PunchDirection;
}

/** Body shape for the GENERIC_WEBHOOK ingestion path — any device
 * middleware/bridge that can make an HTTP POST with JSON uses this,
 * as opposed to the ADMS_PUSH path's device-native text format. */
export class GenericPunchBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GenericPunchEventDto)
  events!: GenericPunchEventDto[];
}
