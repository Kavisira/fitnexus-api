import { IsEnum } from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

export class SelectTrialPlanDto {
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;
}
