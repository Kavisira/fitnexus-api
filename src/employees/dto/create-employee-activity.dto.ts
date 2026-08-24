import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEmployeeActivityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}
