import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class LogWorkoutSetDto {
  @IsString()
  workoutPlanExerciseId!: string;

  @IsInt()
  @Min(1)
  setNumber!: number;

  @IsInt()
  @Min(0)
  reps!: number;

  @IsNumber()
  @Min(0)
  weightKg!: number;

  // Only accepted on the authenticated (trainer) endpoint — lets a
  // trainer back-date a set logged after the fact. The public member
  // endpoint always uses "now" (see FitnessService.logSetAsMember).
  @IsOptional()
  @IsDateString()
  performedAt?: string;
}

/** Trainer-side bulk set logging — the trainer enters reps/weight
 * ONCE for a block of identical sets (e.g. "3 sets x 10 reps @ 20kg")
 * instead of submitting the same values three separate times. Fans
 * out into `sets` individual WorkoutSet rows server-side (see
 * FitnessService.logSetsAsTrainer) so the existing per-set history /
 * "last best weight" groupBy logic needs no changes — this is purely
 * a data-entry convenience, not a schema change. Member self-logging
 * (logSetAsMember) deliberately keeps the single-set LogWorkoutSetDto
 * above, since a member logs one set at a time as they actually
 * finish it. */
export class LogWorkoutSetsBulkDto {
  @IsString()
  workoutPlanExerciseId!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  sets!: number;

  @IsInt()
  @Min(0)
  reps!: number;

  @IsNumber()
  @Min(0)
  weightKg!: number;

  @IsOptional()
  @IsDateString()
  performedAt?: string;
}
