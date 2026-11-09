import { SubscriptionTier } from '@prisma/client';

// Monthly price in INR (minor-unit-free — Cashfree's plan_amount takes a
// plain rupee amount, not paise) for each self-serve tier. ENTERPRISE
// has no listed price — an org only reaches it via a manual, off-platform
// arrangement, never through the checkout flow (see BillingService.checkout,
// which rejects ENTERPRISE outright).
export const TIER_MONTHLY_PRICE_INR: Record<SubscriptionTier, number | null> = {
  STARTER: 700,
  PLUS: 1300,
  GROWTH: 2500,
  PRO: 4500,
  SCALE: 7000,
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
  maxEmployees: number;
  biometricAttendance: boolean;
}

// The actual caps/features each tier grants — the single source of
// truth every branch/member/employee-creation check and the sidenav's
// biometric-attendance gate reads from (see BillingService.effectiveLimits).
// ENTERPRISE's numbers are a placeholder ceiling for bookkeeping only;
// a real ENTERPRISE org's actual limits are whatever was manually
// agreed, not something this table enforces.
export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  STARTER: { maxBranches: 1, maxMembers: 300, maxEmployees: 5, biometricAttendance: false },
  PLUS: { maxBranches: 2, maxMembers: 800, maxEmployees: 12, biometricAttendance: false },
  GROWTH: { maxBranches: 3, maxMembers: 2000, maxEmployees: 25, biometricAttendance: true },
  PRO: { maxBranches: 5, maxMembers: 5000, maxEmployees: 60, biometricAttendance: true },
  SCALE: { maxBranches: 10, maxMembers: 10000, maxEmployees: 150, biometricAttendance: true },
  ENTERPRISE: {
    maxBranches: Number.MAX_SAFE_INTEGER,
    maxMembers: Number.MAX_SAFE_INTEGER,
    maxEmployees: Number.MAX_SAFE_INTEGER,
    biometricAttendance: true,
  },
};

export const TRIAL_DAYS = 30;

// The tier a new org lands on when the signup form doesn't send one —
// the middle of the ladder (biometric attendance on, generous caps),
// so a first-time trial shows the fuller feature set rather than the
// most restrictive one. See AuthService.register.
export const DEFAULT_SIGNUP_TIER: SubscriptionTier = SubscriptionTier.GROWTH;

// Fixed order used for upgrade-direction validation (BillingService
// only allows a PAID org to move to a HIGHER index — see "upgrade
// only, no downgrade" in BillingService.checkout) and for finding the
// lowest tier that fits a given usage footprint (minEligibleTier
// below). ENTERPRISE is deliberately excluded — it's never a
// self-serve upgrade target.
export const SELF_SERVE_TIER_ORDER: SubscriptionTier[] = [
  SubscriptionTier.STARTER,
  SubscriptionTier.PLUS,
  SubscriptionTier.GROWTH,
  SubscriptionTier.PRO,
  SubscriptionTier.SCALE,
];

export interface UsageCounts {
  branches: number;
  members: number;
  employees: number;
  // Whether the org already has at least one biometric attendance
  // device registered — a tier that doesn't grant the feature can
  // never be "eligible" for an org actively using it, same idea as
  // the numeric caps.
  usesBiometric: boolean;
}

// Does this tier's limits cover a given usage footprint? Used both to
// gate which tiers are selectable at signup/trial-plan-switch time and
// to validate a checkout target — see BillingService.eligibleTiers and
// BillingService.checkout.
export function tierSatisfiesUsage(tier: SubscriptionTier, usage: UsageCounts): boolean {
  const limits = TIER_LIMITS[tier];
  return (
    usage.branches <= limits.maxBranches &&
    usage.members <= limits.maxMembers &&
    usage.employees <= limits.maxEmployees &&
    (!usage.usesBiometric || limits.biometricAttendance)
  );
}

// The lowest self-serve tier whose limits cover the given usage, or
// null if even SCALE doesn't fit (meaning only ENTERPRISE, arranged
// manually, actually covers this org). SELF_SERVE_TIER_ORDER is
// monotonically increasing in every dimension, so the first tier
// (in order) that satisfies the usage is also the lowest one that does.
export function minEligibleTier(usage: UsageCounts): SubscriptionTier | null {
  return SELF_SERVE_TIER_ORDER.find((tier) => tierSatisfiesUsage(tier, usage)) ?? null;
}

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
