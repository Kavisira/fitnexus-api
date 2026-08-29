import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
