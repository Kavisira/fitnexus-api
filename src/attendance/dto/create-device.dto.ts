import { BiometricVendorType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  branchId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(BiometricVendorType)
  vendorType!: BiometricVendorType;

  // Required for ADMS_PUSH (that's how the device identifies itself on
  // every request — see AttendanceIngestController) — irrelevant for
  // the other vendor types.
  @ValidateIf((o) => o.vendorType === BiometricVendorType.ADMS_PUSH)
  @IsString()
  @MinLength(1)
  serialNumber?: string;
}
