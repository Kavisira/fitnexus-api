import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateNotificationSetupDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Null clears it (never auto-clean).
  @IsOptional()
  @IsInt()
  @Min(1)
  autoCleanDays?: number | null;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;
}
