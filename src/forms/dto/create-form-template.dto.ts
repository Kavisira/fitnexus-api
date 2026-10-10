import { FormFieldType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class FormFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsEnum(FormFieldType)
  type!: FormFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  // Only meaningful for SINGLE_CHOICE/MULTI_CHOICE — validated against
  // the field's type in FormsService (an option list on a non-choice
  // field is silently ignored, not an error, to keep the DTO simple).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateFormTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields!: FormFieldDto[];
}
