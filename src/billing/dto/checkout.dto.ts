import { IsEnum, IsOptional, IsUrl } from 'class-validator';
import { BillingCycle, SubscriptionTier } from '@prisma/client';

export class CheckoutDto {
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  // The frontend's own origin (window.location.origin) — lets the
  // Cashfree return_url land back on whichever environment actually
  // started the checkout (localhost:4200 during local dev, the real
  // deployed domain in production) instead of a single hardcoded
  // FRONTEND_URL. BillingService.checkout only trusts this when it
  // matches CORS_ORIGINS (same allowlist already used for CORS
  // itself) — otherwise it's ignored and FRONTEND_URL is used, so
  // this can never be abused as an open redirect to an arbitrary
  // domain.
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  returnOrigin?: string;
}
