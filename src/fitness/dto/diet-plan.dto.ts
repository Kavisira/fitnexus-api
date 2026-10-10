import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class DietPlanItemDto {
  @IsString()
  @MinLength(1)
  mealLabel!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpsertDietPlanDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DietPlanItemDto)
  items!: DietPlanItemDto[];
}
