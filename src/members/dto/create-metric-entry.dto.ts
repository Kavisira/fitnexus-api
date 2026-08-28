import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** A single monthly (or whenever-recorded) check-in — weight is the
 * only required number, the tape measurements are optional since not
 * every gym tracks all three. bmi/bmiStatus aren't accepted here at
 * all — MembersService always computes and freezes them itself from
 * the member's current heightCm, they're never client-supplied.
 * photoDataUrl is an optional progress photo, already compressed to a
 * small JPEG data URL client-side (see members.ts) before it ever
 * reaches here — main.ts raises the JSON body limit to fit it. */
export class CreateMetricEntryDto {
  @IsNumber() @Min(1) weightKg!: number;
  @IsOptional() @IsNumber() @Min(1) chestCm?: number;
  @IsOptional() @IsNumber() @Min(1) waistCm?: number;
  @IsOptional() @IsNumber() @Min(1) hipsCm?: number;
  @IsOptional() @IsDateString() recordedAt?: string;
  @IsOptional() @IsString() photoDataUrl?: string;
}
