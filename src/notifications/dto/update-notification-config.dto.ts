import { IsBoolean, IsIn, IsObject, IsOptional } from 'class-validator';

const SEVERITIES = ['INFO', 'WARNING', 'URGENT'] as const;

export class UpdateNotificationConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  // Accepted but not wired to anything yet — see NotificationConfig.rule
  // in the schema for why these exist ahead of the actual channels.
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  // { offsets: [{ value: number, unit: 'MINUTES' | 'HOURS' | 'DAYS' }] }
  // Shape isn't strictly validated here — it varies by notification
  // type and is expected to keep evolving (see product discussion).
  @IsOptional()
  @IsObject()
  rule?: Record<string, unknown> | null;
}
