import { IsString, MinLength } from 'class-validator';

export class RespondReviewDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
