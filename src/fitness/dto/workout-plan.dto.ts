import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class WorkoutPlanExerciseDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(1)
  targetSets!: number;

  @IsInt()
  @Min(1)
  targetReps!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWeightKg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  muscleGroup?: string;

  // Optional day-of-split tag (1-7); null/omitted = unsorted/flat.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  day?: number;
}

export class UpsertWorkoutPlanDto {
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
  @Type(() => WorkoutPlanExerciseDto)
  exercises!: WorkoutPlanExerciseDto[];
}
