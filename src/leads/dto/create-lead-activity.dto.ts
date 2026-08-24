import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLeadActivityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;

  // Optional — when a follow-up note also sets/updates the next
  // follow-up date+time, it's carried alongside the note.
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}
