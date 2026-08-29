import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionNote?: string;
}
