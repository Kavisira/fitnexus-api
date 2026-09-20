import { PunchDirection } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/** Body shape for a logged-in Owner/manager manually firing a test
 * punch against a real device row (see AttendanceDevicesService.simulatePunch)
 * — for testing the full attendance pipeline (recording, nightly
 * aggregation, calendars, absentee detection) without physical
 * biometric hardware. Goes through the exact same recordPunches()
 * logic every real device's ingestion path uses; only the auth model
 * differs — this is a JWT-authenticated admin action instead of a
 * device calling in with its serial number or API key. */
export class SimulatePunchDto {
  @IsString()
  @MinLength(1)
  biometricUserId!: string;

  // Defaults to "now" if omitted — but accepting an explicit timestamp
  // is what makes this useful for testing: a past date/time lets you
  // build up a whole day's (or week's) worth of punches to exercise
  // present/absent/half-day/late aggregation without waiting in real
  // time for each one.
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsEnum(PunchDirection)
  direction?: PunchDirection;
}
