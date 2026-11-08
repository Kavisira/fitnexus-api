import { SubscriptionTier } from '@prisma/client';

// Monthly price in INR (minor-unit-free — Cashfree's plan_amount takes a
// plain rupee amount, not paise) for each self-serve tier. ENTERPRISE
// has no listed price — an org only reaches it via a manual, off-platform
// arrangement, never through the checkout flow (see BillingService.checkout,
// which rejects ENTERPRISE outright).
export const TIER_MONTHLY_PRICE_INR: Record<SubscriptionTier, number | null> = {
  BASIC: 500,
  STARTER: 600,
  PLUS: 800,
  PLUS_PLUS: 1000,
  PRO: 1500,
  GROWTH: 3000,
  GROWTH_PLUS: 5500,
  SCALE: 9000,
  ENTERPRISE: null,
};

// Annual price = 10 months' worth of the monthly price (the "2 months
// free" discount agreed on) — computed here rather than stored, so the
// discount shape only ever needs to change in one place.
export function annualPriceInr(tier: SubscriptionTier): number | null {
  const monthly = TIER_MONTHLY_PRICE_INR[tier];
  return monthly === null ? null : monthly * 10;
}

export interface TierLimits {
  maxBranches: number;
  maxMembers: number;
  biometricAttendance: boolean;
}

// The actual caps/features each tier grants — the single source of
// truth every branch/member-creation check and the sidenav's
// biometric-attendance gate reads from (see BillingService.effectiveLimits,
// which also handles the TRIALING case — full access, not this table).
// ENTERPRISE's numbers are a placeholder ceiling for bookkeeping only;
// a real ENTERPRISE org's actual limits are whatever was manually
// agreed, not something this table enforces.
export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  BASIC: { maxBranches: 1, maxMembers: 200, biometricAttendance: false },
  STARTER: { maxBranches: 1, maxMembers: 200, biometricAttendance: false },
  PLUS: { maxBranches: 2, maxMembers: 500, biometricAttendance: true },
  PLUS_PLUS: { maxBranches: 2, maxMembers: 1000, biometricAttendance: true },
  PRO: { maxBranches: 3, maxMembers: 2000, biometricAttendance: true },
  GROWTH: { maxBranches: 5, maxMembers: 3500, biometricAttendance: true },
  GROWTH_PLUS: { maxBranches: 7, maxMembers: 5000, biometricAttendance: true },
  SCALE: { maxBranches: 10, maxMembers: 10000, biometricAttendance: true },
  ENTERPRISE: { maxBranches: Number.MAX_SAFE_INTEGER, maxMembers: Number.MAX_SAFE_INTEGER, biometricAttendance: true },
};

// Trial gets full (Scale-equivalent) access during the 30-day window —
// the whole point of a trial is to show maximum value, not a crippled
// preview. See BillingService.effectiveLimits.
export const TRIAL_LIMITS: TierLimits = TIER_LIMITS.SCALE;

export const TRIAL_DAYS = 30;

// Fixed order used for upgrade-direction validation (BillingService
// only allows moving to a HIGHER index — see "upgrade only, no
// downgrade" in BillingService.checkout). ENTERPRISE is deliberately
// excluded — it's never a self-serve upgrade target.
export const SELF_SERVE_TIER_ORDER: SubscriptionTier[] = [
  SubscriptionTier.BASIC,
  SubscriptionTier.STARTER,
  SubscriptionTier.PLUS,
  SubscriptionTier.PLUS_PLUS,
  SubscriptionTier.PRO,
  SubscriptionTier.GROWTH,
  SubscriptionTier.GROWTH_PLUS,
  SubscriptionTier.SCALE,
];

export interface SubscriptionSummary {
  tier: SubscriptionTier | null;
  status: string;
  billingCycle: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  isExpired: boolean;
}

// Single source of truth for "has this org's trial/paid period run
// out" — reused by JwtStrategy.validate (per-request auth check),
// toSubscriptionSummary below (login/dashboard display),
// SubscriptionGuard (write+read blocking once expired), and
// NotificationsCronService (suppressing renewal-flavored notifications
// once an org is locked out). Never trust a stored flag — always
// recompute from subscriptionStatus/currentPeriodEnd fresh.
export function isOrgSubscriptionExpired(org: { subscriptionStatus: string; currentPeriodEnd: Date | null }): boolean {
  return org.subscriptionStatus === 'EXPIRED' || (!!org.currentPeriodEnd && org.currentPeriodEnd.getTime() < Date.now());
}

// Shared by AuthService.login/getMe and BillingService.status — the
// single place that turns the raw Organization columns into the shape
// both the login response and the dashboard countdown widget read.
export function toSubscriptionSummary(org: {
  subscriptionTier: SubscriptionTier | null;
  subscriptionStatus: string;
  billingCycle: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}): SubscriptionSummary {
  const isExpired = isOrgSubscriptionExpired(org);
  return {
    tier: org.subscriptionTier,
    status: org.subscriptionStatus,
    billingCycle: org.billingCycle,
    trialEndsAt: org.trialEndsAt,
    currentPeriodEnd: org.currentPeriodEnd,
    isExpired,
  };
}
