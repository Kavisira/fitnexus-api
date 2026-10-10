import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class FormAnswerInputDto {
  // formFieldId is matched against the template's own field list in
  // FormsService — unrecognized ids are rejected there, not here.
  @IsString()
  formFieldId!: string;

  textValue?: string;
  numberValue?: number;
  booleanValue?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  choiceValues?: string[];
}

export class SubmitFormDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => FormAnswerInputDto)
  answers!: FormAnswerInputDto[];
}
