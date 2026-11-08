import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CashfreeService } from './cashfree.service';
import {
  SELF_SERVE_TIER_ORDER,
  TIER_LIMITS,
  TIER_MONTHLY_PRICE_INR,
  TRIAL_DAYS,
  TRIAL_LIMITS,
  TierLimits,
  annualPriceInr,
  toSubscriptionSummary,
} from './billing.constants';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BillingCycle, SubscriptionEventOutcome, SubscriptionEventSource, SubscriptionTier } from '@prisma/client';

/**
 * Owns everything subscription-shaped: the caps a plan grants
 * (effectiveLimits), starting a Cashfree checkout for an upgrade
 * (checkout — deliberately upgrade-only), and applying Cashfree's
 * webhook events back onto the Organization row (handleWebhook).
 * Payment-method mechanics live in CashfreeService; this is the
 * business layer on top of it.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private cashfree: CashfreeService,
    private config: ConfigService,
  ) {}

  /** The caps/features this org actually has right now — full
   * (Scale-equivalent) access while TRIALING, otherwise whatever its
   * paid tier grants. Every branch/member-creation check and the
   * biometric-attendance gate should read from this, not TIER_LIMITS
   * directly. */
  async effectiveLimits(organizationId: string): Promise<TierLimits> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, subscriptionTier: true },
    });
    if (!org) {
      throw new BadRequestException('Organization not found.');
    }
    if (org.subscriptionStatus === 'TRIALING') {
      return TRIAL_LIMITS;
    }
    if (!org.subscriptionTier) {
      return TIER_LIMITS.BASIC;
    }
    return TIER_LIMITS[org.subscriptionTier];
  }

  async status(user: AuthenticatedUser) {
    const org = await this.ensureTrialStarted(user.organizationId);
    return toSubscriptionSummary(org);
  }

  /** Backfills trialEndsAt/currentPeriodEnd for an org that reached
   * TRIALING before those columns existed, or whose
   * verifyRegisterOtp run otherwise never set them (e.g. a row
   * created directly in the DB during earlier development/seeding).
   * Without this, the dashboard/login/billing-status countdown has
   * nothing to count down from and silently renders no number at all.
   * A no-op (just returns the org as-is) once trialEndsAt is already
   * set, or once the org has moved off TRIALING entirely. */
  async ensureTrialStarted(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        subscriptionTier: true,
        subscriptionStatus: true,
        billingCycle: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });
    if (!org) {
      throw new BadRequestException('Organization not found.');
    }
    if (org.subscriptionStatus === 'TRIALING' && !org.trialEndsAt) {
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      return this.prisma.organization.update({
        where: { id: organizationId },
        data: { trialEndsAt, currentPeriodEnd: trialEndsAt },
        select: {
          subscriptionTier: true,
          subscriptionStatus: true,
          billingCycle: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
        },
      });
    }
    return org;
  }

  /** Starts (or upgrades) a paid subscription via Cashfree. Strictly
   * upgrade-only — an org already on a self-serve tier can only move to
   * a HIGHER one; there is no downgrade path at all. ENTERPRISE is
   * never a valid target here — that tier is only ever arranged
   * manually. Returns the Cashfree-hosted authorization URL the
   * frontend redirects the user to; the actual tier/status flip
   * happens in handleWebhook once Cashfree confirms the mandate + first
   * charge, not here. */
  async checkout(user: AuthenticatedUser, tier: SubscriptionTier, billingCycle: BillingCycle, returnOrigin?: string) {
    if (tier === 'ENTERPRISE') {
      throw new BadRequestException('Enterprise is arranged directly with us — please contact support.');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      include: { users: { where: { role: 'OWNER' }, take: 1 } },
    });
    if (!org) {
      throw new BadRequestException('Organization not found.');
    }

    if (org.subscriptionTier) {
      const currentIdx = SELF_SERVE_TIER_ORDER.indexOf(org.subscriptionTier);
      const targetIdx = SELF_SERVE_TIER_ORDER.indexOf(tier);
      if (targetIdx <= currentIdx) {
        throw new ForbiddenException('Only upgrading to a higher tier is supported — downgrades are not available.');
      }
    }

    const monthly = TIER_MONTHLY_PRICE_INR[tier];
    if (monthly === null) {
      throw new BadRequestException('This tier has no self-serve price.');
    }
    const amountInr = billingCycle === 'ANNUAL' ? (annualPriceInr(tier) as number) : monthly;
    const intervalType = billingCycle === 'ANNUAL' ? 'YEAR' : 'MONTH';

    const owner = org.users[0];
    const subscriptionId = `fitnexus_${org.id.slice(0, 8)}_${randomUUID().slice(0, 8)}`;
    const frontendOrigin = this.resolveFrontendOrigin(returnOrigin);

    let result;
    try {
      // Cashfree's hosted checkout returns the browser with a POST, not
      // a GET — pointing return_url straight at an Angular SPA route
      // then fails with "Cannot POST /billing" (the dev server / static
      // host only rewrites GET requests to index.html). So return_url
      // points at this API instead (a real server, happy to accept a
      // POST), and /billing/return below does the actual 302 redirect
      // (always a GET) to the frontend's /billing page — browsers
      // always follow a redirect with GET regardless of the original
      // method, so the SPA route only ever sees a GET.
      result = await this.cashfree.createSubscription({
        subscriptionId,
        customerId: org.cashfreeCustomerId ?? org.id,
        customerName: org.name,
        customerEmail: owner?.email ?? '',
        customerPhone: owner?.phone ?? '',
        planName: `FitNexus ${tier}`,
        amountInr,
        intervalType,
        returnUrl: this.buildReturnUrl(frontendOrigin),
      });
    } catch (err) {
      // Captured even though this never reaches Cashfree's own
      // webhook/sync — e.g. the plan_max_amount validation error hit
      // earlier in this integration. Without this, a checkout that
      // fails before the customer ever sees Cashfree's page would
      // leave no trace in the history at all.
      await this.recordEvent(org.id, {
        eventType: 'CHECKOUT_FAILED',
        outcome: SubscriptionEventOutcome.FAILED,
        source: SubscriptionEventSource.CHECKOUT,
        tier,
        billingCycle,
        amountInr,
        description: err instanceof Error ? err.message : 'Checkout failed to start.',
      });
      throw err;
    }

    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        cashfreeCustomerId: org.cashfreeCustomerId ?? org.id,
        cashfreeSubscriptionId: result.cfSubscriptionId,
        // Our OWN generated id — needed to fetch/sync this
        // subscription later (see syncFromCashfree), since Cashfree's
        // fetch-subscription endpoint takes this one, not
        // cf_subscription_id above.
        cashfreeSubscriptionRef: subscriptionId,
      },
    });

    // Just the start of checkout, not a confirmed payment — INFO, not
    // SUCCESS. The actual SUCCESS row is written once Cashfree
    // confirms the mandate + first charge (handleWebhook /
    // syncFromCashfree below).
    await this.recordEvent(org.id, {
      eventType: 'CHECKOUT_STARTED',
      outcome: SubscriptionEventOutcome.INFO,
      source: SubscriptionEventSource.CHECKOUT,
      tier,
      billingCycle,
      amountInr,
      description: `Checkout started for ${tier} (${billingCycle === 'ANNUAL' ? 'annual' : 'monthly'}).`,
    });

    return { subscriptionSessionId: result.subscriptionSessionId, cfSubscriptionId: result.cfSubscriptionId };
  }

  /** The frontend origin this checkout should eventually return to —
   * whatever the caller said it started from (window.location.origin),
   * but ONLY if it's in the same CORS_ORIGINS allowlist the app
   * already trusts for CORS itself (main.ts). Anything else (missing,
   * malformed, or just not an origin this app serves from) falls back
   * to FRONTEND_URL, so this can never be used to redirect a user to
   * an arbitrary third-party domain. */
  private resolveFrontendOrigin(returnOrigin?: string): string {
    const allowedOrigins = (this.config.get<string>('CORS_ORIGINS') ?? '').split(',').map((o) => o.trim());
    const fallbackUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://myfitnexusapp.com';
    return returnOrigin && allowedOrigins.includes(returnOrigin) ? returnOrigin : fallbackUrl;
  }

  /** The URL Cashfree itself is told to return the browser to — this
   * API's own /billing/return (see BillingController.return), which
   * then 302s onward to the frontend. Never the frontend origin
   * directly — see the comment in checkout() for why. */
  private buildReturnUrl(frontendOrigin: string): string {
    const publicApiUrl = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000/api';
    return `${publicApiUrl}/billing/return?origin=${encodeURIComponent(frontendOrigin)}`;
  }

  /** Called by BillingController.return once Cashfree's hosted
   * checkout bounces the browser back here (by POST — see checkout()
   * above) — resolves the `origin` query param through the exact same
   * allowlist as checkout() itself, so a tampered/arbitrary origin on
   * this public, unauthenticated GET/POST still can't be used as an
   * open redirect. */
  redirectUrlForReturn(origin?: string): string {
    return `${this.resolveFrontendOrigin(origin)}/billing?checkout=return`;
  }

  /** Best-effort capture of the outcome Cashfree hands back directly
   * on the checkout-return redirect itself (cf_subscriptionId,
   * cf_checkoutStatus, cf_message — per Cashfree's own
   * redirection-payload docs). This is the ONLY reliable signal for a
   * REJECTED first-time mandate authorization: a failed auth leaves
   * the subscription in a pending state (not ACTIVE/CANCELLED/
   * ON_HOLD), which syncFromCashfree's fetch-subscription call doesn't
   * recognize as anything actionable, so without this a rejected test
   * payment left no FAILED row at all. Cashfree's own docs note these
   * fields can be MISSING in production (only guaranteed in sandbox),
   * so this silently no-ops rather than erroring when they're absent
   * — it's a bonus signal on top of the webhook/sync paths, never the
   * only one relied on. Never blocks the actual redirect: called from
   * BillingController.return and swallows its own errors. */
  async recordReturnOutcome(params: { cfSubscriptionId?: string; checkoutStatus?: string; message?: string; raw: unknown }) {
    if (!params.cfSubscriptionId || !params.checkoutStatus) {
      return;
    }
    try {
      // BUG FIX: Cashfree's checkout-return redirect names this field
      // `cf_subscriptionId`, but it's actually OUR OWN merchant
      // subscription_id (what we store as cashfreeSubscriptionRef) —
      // their own numeric cf_subscription_id comes back separately as
      // `cf_subReferenceId` on this exact redirect (confusingly the
      // OPPOSITE naming from their webhook/API payloads, where
      // cf_subscription_id really is their own numeric id — see
      // handleWebhook above, which looks that one up correctly).
      // Looking this up against cashfreeSubscriptionId (as this used
      // to) never matched anything, so this whole method silently
      // no-op'd for every single checkout, success or failure.
      const org = await this.prisma.organization.findFirst({ where: { cashfreeSubscriptionRef: params.cfSubscriptionId } });
      if (!org) {
        return;
      }

      const succeeded = ['SUCCESS', 'SUCCESS_DEBIT_PENDING', 'SUCCESS_TOKENIZATION_PENDING'].includes(params.checkoutStatus);

      if (succeeded) {
        // Activate the plan RIGHT HERE rather than waiting on sync()'s
        // own GET /subscriptions/{id} call — in sandbox that GET can
        // still report a stale pre-authorization status (INITIALIZED)
        // for a few seconds after Cashfree's own redirect has already
        // confirmed the mandate succeeded, which is what made "payment
        // succeeded but the plan never updated" reproducible every
        // time. Cashfree's redirect itself (checkoutStatus/this
        // method) is the authoritative, immediate signal for mandate
        // success — sync()/the webhook remain the source of truth for
        // everything AFTER this (renewals, cancellations), but the
        // very first activation shouldn't have to wait for either.
        // tier/billingCycle come from this org's own CHECKOUT_STARTED
        // event (recorded a moment ago in checkout()) rather than
        // Cashfree's plan_name, which isn't present on this redirect
        // at all.
        const lastCheckout = await this.prisma.subscriptionEvent.findFirst({
          where: { organizationId: org.id, eventType: 'CHECKOUT_STARTED' },
          orderBy: { createdAt: 'desc' },
        });
        const intervalType = lastCheckout?.billingCycle === 'ANNUAL' ? 'YEAR' : 'MONTH';
        await this.applyActivation(
          org.id,
          undefined,
          intervalType,
          SubscriptionEventSource.CHECKOUT,
          'RETURN_SUCCESS',
          params.raw,
          lastCheckout?.tier ?? org.subscriptionTier ?? null,
        );
      } else {
        await this.recordEvent(org.id, {
          eventType: 'CHECKOUT_RETURN_FAILED',
          outcome: SubscriptionEventOutcome.FAILED,
          source: SubscriptionEventSource.CHECKOUT,
          tier: org.subscriptionTier,
          billingCycle: org.billingCycle,
          amountInr: null,
          description: params.message || `Checkout did not complete (${params.checkoutStatus}).`,
          rawPayload: params.raw,
        });
      }
    } catch (err) {
      this.logger.error('Failed to record checkout-return outcome', err instanceof Error ? err.stack : undefined);
    }
  }

  /** Verifies Cashfree's webhook signature (HMAC-SHA256 over
   * timestamp+rawBody, base64-encoded) before trusting anything in the
   * payload. */
  verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
    const secret = this.config.get<string>('CASHFREE_CLIENT_SECRET') ?? '';
    const expected = createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
    return expected === signature;
  }

  /** Real Cashfree subscription webhook event types (verified against
   * Cashfree's own docs — the earlier version of this method checked
   * for invented names like SUBSCRIPTION_ACTIVATED/
   * SUBSCRIPTION_CHARGE_SUCCESS that don't actually exist, which is
   * why nothing — success OR failure — was ever reaching the history
   * table):
   *  - SUBSCRIPTION_AUTH_STATUS: the one-time mandate-setup payment's
   *    own result (success or failure) — data.authorization_details.
   *    authorization_status / data.payment_status, data.failure_details.
   *    failure_reason. Logged as its own transaction row either way,
   *    but does NOT by itself flip the org's tier/status — that only
   *    happens once SUBSCRIPTION_STATUS_CHANGED confirms ACTIVE (the
   *    only event that carries data.plan_details, i.e. the actual tier).
   *  - SUBSCRIPTION_STATUS_CHANGED: the subscription's own status
   *    moving to ACTIVE / ON_HOLD / COMPLETED / CANCELLED / EXPIRED /
   *    BANK_APPROVAL_PENDING — data.subscription_details.
   *    subscription_status, data.plan_details.{plan_name,plan_interval_type}.
   *  - SUBSCRIPTION_PAYMENT_SUCCESS / SUBSCRIPTION_PAYMENT_FAILED: a
   *    later RENEWAL charge on an already-active subscription — same
   *    data shape as SUBSCRIPTION_AUTH_STATUS, no plan_details.
   *  - SUBSCRIPTION_PAYMENT_CANCELLED: the customer backed out of a
   *    renewal charge screen — logged, no status change (one missed
   *    payment screen isn't the same as a bank-declined charge). */
  async handleWebhook(payload: any) {
    const eventType: string = payload?.type ?? '';
    const data = payload?.data ?? {};
    const cfSubscriptionId: string | undefined = data?.subscription_details?.cf_subscription_id ?? data?.cf_subscription_id;
    if (!cfSubscriptionId) {
      this.logger.warn(`Cashfree webhook (${eventType}) with no cf_subscription_id: ${JSON.stringify(payload)}`);
      return { received: true };
    }

    const org = await this.prisma.organization.findFirst({ where: { cashfreeSubscriptionId: cfSubscriptionId } });
    if (!org) {
      this.logger.warn(`Cashfree webhook (${eventType}) for unknown subscription ${cfSubscriptionId}`);
      return { received: true };
    }

    if (eventType === 'SUBSCRIPTION_AUTH_STATUS') {
      const authStatus = data?.authorization_details?.authorization_status;
      const paymentStatus = data?.payment_status;
      const failed = authStatus === 'FAILED' || paymentStatus === 'FAILED';
      await this.recordEvent(org.id, {
        eventType,
        outcome: failed ? SubscriptionEventOutcome.FAILED : SubscriptionEventOutcome.SUCCESS,
        source: SubscriptionEventSource.WEBHOOK,
        amountInr: data?.authorization_details?.authorization_amount ?? data?.payment_amount ?? null,
        description: failed
          ? this.extractFailureDescription(payload) ?? 'Mandate authorization failed.'
          : 'Mandate authorization succeeded.',
        rawPayload: payload,
      });
      // No tier/status mutation here — see the doc comment above.
    } else if (eventType === 'SUBSCRIPTION_STATUS_CHANGED') {
      const status: string | undefined = data?.subscription_details?.subscription_status;
      const planName = data?.plan_details?.plan_name;
      const intervalType = data?.plan_details?.plan_interval_type;
      if (status === 'ACTIVE') {
        await this.applyActivation(org.id, planName, intervalType, SubscriptionEventSource.WEBHOOK, eventType, payload);
      } else if (status === 'CANCELLED' || status === 'COMPLETED' || status === 'EXPIRED') {
        await this.applyCancellation(org.id, eventType, SubscriptionEventSource.WEBHOOK, payload);
      } else if (status === 'ON_HOLD') {
        await this.applyFailure(org.id, eventType, SubscriptionEventSource.WEBHOOK, payload);
      } else {
        this.logger.log(`SUBSCRIPTION_STATUS_CHANGED → ${status} (no action, e.g. still BANK_APPROVAL_PENDING)`);
      }
    } else if (eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
      await this.applyRenewalSuccess(org.id, eventType, payload);
    } else if (eventType === 'SUBSCRIPTION_PAYMENT_FAILED') {
      await this.applyFailure(org.id, eventType, SubscriptionEventSource.WEBHOOK, payload);
    } else if (eventType === 'SUBSCRIPTION_PAYMENT_CANCELLED') {
      await this.recordEvent(org.id, {
        eventType,
        outcome: SubscriptionEventOutcome.FAILED,
        source: SubscriptionEventSource.WEBHOOK,
        amountInr: data?.payment_amount ?? null,
        description: 'Payment was cancelled before completing.',
        rawPayload: payload,
      });
    } else {
      this.logger.log(`Unhandled Cashfree webhook event type: ${eventType}`);
    }

    return { received: true };
  }

  /** Pulls the subscription's current state straight from Cashfree
   * instead of waiting for a webhook — Cashfree's webhook can only
   * reach a publicly-reachable PUBLIC_API_URL, so during local
   * development (where that's http://localhost:3000) it never
   * arrives at all and the org would otherwise stay stuck on
   * TRIALING forever after a real sandbox payment. Called by the
   * frontend right after the /billing?checkout=return redirect lands,
   * so the new plan is reflected immediately regardless of whether
   * the webhook can reach this environment. Safe to call anytime
   * (e.g. the user refreshes mid-checkout) — it's a read of
   * Cashfree's own source of truth, not something that can be abused
   * to grant a plan that was never actually paid for. */
  async syncFromCashfree(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { cashfreeSubscriptionRef: true },
    });
    this.logger.log(`syncFromCashfree: org ${organizationId} has cashfreeSubscriptionRef = ${org?.cashfreeSubscriptionRef ?? '(none)'}`);
    if (!org?.cashfreeSubscriptionRef) {
      this.logger.warn(`syncFromCashfree: org ${organizationId} has no cashfreeSubscriptionRef at all — nothing to sync, leaving as-is.`);
      return toSubscriptionSummary(await this.ensureTrialStarted(organizationId));
    }

    const remote = await this.cashfree.getSubscription(org.cashfreeSubscriptionRef);
    this.logger.log(`syncFromCashfree: Cashfree returned subscription_status = "${remote?.subscription_status}" for ${org.cashfreeSubscriptionRef}`);
    const status: string = remote?.subscription_status ?? '';
    if (status === 'ACTIVE') {
      await this.applyActivation(
        organizationId,
        remote?.plan_details?.plan_name,
        remote?.plan_details?.plan_interval_type,
        SubscriptionEventSource.SYNC,
        `SYNC_${status}`,
        remote,
      );
    } else if (status === 'CANCELLED' || status === 'COMPLETED') {
      await this.applyCancellation(organizationId, `SYNC_${status}`, SubscriptionEventSource.SYNC, remote);
    } else if (status === 'ON_HOLD' || status === 'PAUSED') {
      await this.applyFailure(organizationId, `SYNC_${status}`, SubscriptionEventSource.SYNC, remote);
    } else {
      // Any other status (INITIALIZED, BANK_APPROVAL_PENDING, …) means
      // the mandate isn't actually confirmed ACTIVE yet by Cashfree's
      // own record — left exactly as-is rather than guessing. Recorded
      // as its OWN visible history row (not just a server log) because
      // this is the #1 place "I paid but the plan never updated" turns
      // out to be a genuine, not-yet-ACTIVE status on Cashfree's own
      // side rather than a bug here — surfacing the real status value
      // directly in the Owner's own History panel means they don't
      // need server/terminal access to see why. Deduped per distinct
      // status (groupKey-less recordEvent would otherwise spam one
      // row per sync() call/page reload while stuck in this state).
      const alreadyLogged = await this.prisma.subscriptionEvent.findFirst({
        where: { organizationId, eventType: `SYNC_PENDING_${status || 'UNKNOWN'}` },
      });
      if (!alreadyLogged) {
        await this.recordEvent(organizationId, {
          eventType: `SYNC_PENDING_${status || 'UNKNOWN'}`,
          outcome: SubscriptionEventOutcome.INFO,
          source: SubscriptionEventSource.SYNC,
          tier: null,
          billingCycle: null,
          amountInr: null,
          description: `Cashfree reports this subscription's status as "${status || '(empty)'}" — not yet ACTIVE, so your plan hasn't changed. This usually means the mandate was approved but Cashfree hasn't posted the first charge yet; check the subscription in your Cashfree dashboard.`,
          rawPayload: remote,
        });
      }
      this.logger.warn(
        `syncFromCashfree: org ${organizationId}'s subscription ${org.cashfreeSubscriptionRef} is "${status || '(empty)'}" on Cashfree — not ACTIVE/CANCELLED/ON_HOLD, so nothing was changed.`,
      );
    }

    const refreshed = await this.ensureTrialStarted(organizationId);
    return toSubscriptionSummary(refreshed);
  }

  /** Shared by handleWebhook (push, from Cashfree) and syncFromCashfree
   * (pull, from this API) — both resolve to the same inputs (a plan
   * name to read the tier off of, and an interval type for how long
   * the new period lasts) so there's one single place that actually
   * writes ACTIVE + the tier + the next currentPeriodEnd, AND records
   * the SUCCESS history row. Only records that row on an actual
   * transition (first activation, a tier change, or the period
   * actually advancing) — syncFromCashfree can be called repeatedly
   * while already active, and that must never spam duplicate
   * "payment successful" rows into the invoice/audit history. */
  private async applyActivation(
    organizationId: string,
    planName: string | undefined,
    intervalType: string | undefined,
    source: SubscriptionEventSource,
    eventType: string,
    rawPayload?: unknown,
    // Set when the caller already knows the tier directly (e.g.
    // recordReturnOutcome, reading it off this org's own
    // CHECKOUT_STARTED event) rather than needing it parsed back out
    // of a Cashfree plan_name string — skips tierFromPlanName entirely
    // when present.
    knownTier?: SubscriptionTier | null,
  ) {
    const prior = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, subscriptionTier: true, currentPeriodEnd: true },
    });

    const periodDays = intervalType === 'YEAR' ? 365 : 30;
    const tier = knownTier ?? this.tierFromPlanName(planName) ?? prior?.subscriptionTier ?? null;
    const billingCycle: BillingCycle = intervalType === 'YEAR' ? 'ANNUAL' : 'MONTHLY';
    const currentPeriodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        subscriptionStatus: 'ACTIVE',
        ...(tier ? { subscriptionTier: tier } : {}),
        billingCycle,
        currentPeriodEnd,
      },
    });

    const isTransition =
      !prior ||
      prior.subscriptionStatus !== 'ACTIVE' ||
      prior.subscriptionTier !== tier ||
      // A genuinely new charge cycle moves currentPeriodEnd forward by
      // more than a few seconds — guards against float/clock noise
      // between two syncs issued back-to-back.
      Math.abs((prior.currentPeriodEnd?.getTime() ?? 0) - currentPeriodEnd.getTime()) > 60_000;

    if (isTransition) {
      const amountInr = tier ? (billingCycle === 'ANNUAL' ? annualPriceInr(tier) : TIER_MONTHLY_PRICE_INR[tier]) : null;
      await this.recordEvent(organizationId, {
        eventType,
        outcome: SubscriptionEventOutcome.SUCCESS,
        source,
        tier,
        billingCycle,
        amountInr,
        description: `Payment successful — now on ${tier ?? 'an upgraded plan'} (${billingCycle === 'ANNUAL' ? 'annual' : 'monthly'}), valid until ${currentPeriodEnd.toDateString()}.`,
        rawPayload,
      });
    }
  }

  /** A later RENEWAL charge succeeding on an already-active
   * subscription (SUBSCRIPTION_PAYMENT_SUCCESS) — no plan_details in
   * this payload shape, so unlike applyActivation this reuses the
   * org's EXISTING tier/billingCycle rather than trying to re-derive
   * them, and simply extends currentPeriodEnd. Always logs (each
   * renewal webhook is its own real transaction, never a repeat poll,
   * so no dedup needed here unlike applyActivation). */
  private async applyRenewalSuccess(organizationId: string, eventType: string, rawPayload?: unknown) {
    const prior = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionTier: true, billingCycle: true },
    });

    const periodDays = prior?.billingCycle === 'ANNUAL' ? 365 : 30;
    const currentPeriodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus: 'ACTIVE', currentPeriodEnd },
    });

    const data = (rawPayload as any)?.data;
    const amountInr = data?.payment_amount ?? (prior?.subscriptionTier
      ? prior.billingCycle === 'ANNUAL'
        ? annualPriceInr(prior.subscriptionTier)
        : TIER_MONTHLY_PRICE_INR[prior.subscriptionTier]
      : null);

    await this.recordEvent(organizationId, {
      eventType,
      outcome: SubscriptionEventOutcome.SUCCESS,
      source: SubscriptionEventSource.WEBHOOK,
      tier: prior?.subscriptionTier ?? null,
      billingCycle: prior?.billingCycle ?? null,
      amountInr,
      description: `Renewal payment successful — valid until ${currentPeriodEnd.toDateString()}.`,
      rawPayload,
    });
  }

  /** A charge/mandate failure — unlike activation, this is ALWAYS
   * recorded (never deduped), because every failed attempt is its own
   * meaningful event for an invoice/audit trail, even if the org was
   * already PAST_DUE from a previous failure. */
  private async applyFailure(organizationId: string, eventType: string, source: SubscriptionEventSource, rawPayload?: unknown) {
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus: 'PAST_DUE' },
      select: { subscriptionTier: true, billingCycle: true },
    });

    const description = this.extractFailureDescription(rawPayload) ?? `Payment failed (${eventType}).`;
    await this.recordEvent(organizationId, {
      eventType,
      outcome: SubscriptionEventOutcome.FAILED,
      source,
      tier: org.subscriptionTier,
      billingCycle: org.billingCycle,
      amountInr: null,
      description,
      rawPayload,
    });
  }

  /** Best-effort extraction of a human-readable reason out of
   * whatever Cashfree's webhook/fetch payload shape actually sent —
   * their field names differ slightly between a webhook event and a
   * fetch-subscription response, so this tries the ones seen in
   * practice rather than assuming one fixed shape. */
  private extractFailureDescription(payload: unknown): string | null {
    const p = payload as any;
    // data.failure_details.failure_reason is the real field Cashfree
    // sends on SUBSCRIPTION_AUTH_STATUS / SUBSCRIPTION_PAYMENT_FAILED
    // (verified against their docs — "DEBIT HAS BEEN FAILED" etc.).
    // The rest are best-effort fallbacks for shapes not fully
    // confirmed (a plain fetch-subscription error response, etc).
    return (
      p?.data?.failure_details?.failure_reason ??
      p?.failure_details?.failure_reason ??
      p?.data?.error?.message ??
      p?.message ??
      null
    );
  }

  /** A cancellation/completion — deduped the same way as activation
   * (only logged on an actual transition away from CANCELLED), since
   * syncFromCashfree can observe the same CANCELLED state repeatedly. */
  private async applyCancellation(organizationId: string, eventType: string, source: SubscriptionEventSource, rawPayload?: unknown) {
    const prior = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, subscriptionTier: true, billingCycle: true },
    });
    if (prior?.subscriptionStatus === 'CANCELLED') {
      return;
    }

    await this.prisma.organization.update({ where: { id: organizationId }, data: { subscriptionStatus: 'CANCELLED' } });
    await this.recordEvent(organizationId, {
      eventType,
      outcome: SubscriptionEventOutcome.INFO,
      source,
      tier: prior?.subscriptionTier ?? null,
      billingCycle: prior?.billingCycle ?? null,
      amountInr: null,
      description: `Subscription cancelled (${eventType}).`,
      rawPayload,
    });
  }

  /** The one place that writes to subscription_events — every other
   * method above goes through this rather than calling
   * prisma.subscriptionEvent.create directly. Never called from
   * resetToTrial — that stays purely a testing tool and must never
   * show up in this invoice/audit trail. Best-effort: a logging
   * failure here is swallowed (logged, not thrown) so it can never
   * break the actual billing operation it's recording. */
  private async recordEvent(
    organizationId: string,
    event: {
      eventType: string;
      outcome: SubscriptionEventOutcome;
      source: SubscriptionEventSource;
      tier?: SubscriptionTier | null;
      billingCycle?: BillingCycle | null;
      amountInr?: number | null;
      description?: string | null;
      rawPayload?: unknown;
    },
  ): Promise<void> {
    try {
      await this.prisma.subscriptionEvent.create({
        data: {
          organizationId,
          eventType: event.eventType,
          outcome: event.outcome,
          source: event.source,
          tier: event.tier ?? null,
          billingCycle: event.billingCycle ?? null,
          amountInr: event.amountInr ?? null,
          description: event.description ?? null,
          rawPayload: event.rawPayload === undefined ? null : (event.rawPayload as any),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record subscription event (${event.eventType})`, err instanceof Error ? err.stack : undefined);
    }
  }

  /** The org's full billing/payment history — invoice list and audit
   * trail in one, newest first. Owner-only, same as every other
   * billing action. Never includes resetToTrial activity (see its own
   * doc comment) — this is real activity only. */
  async history(user: AuthenticatedUser) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can view billing history.');
    }
    return this.prisma.subscriptionEvent.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        eventType: true,
        outcome: true,
        source: true,
        tier: true,
        billingCycle: true,
        amountInr: true,
        description: true,
        createdAt: true,
      },
    });
  }

  private tierFromPlanName(planName?: string): SubscriptionTier | null {
    if (!planName) return null;
    const match = /FitNexus (\w+)/.exec(planName);
    const candidate = match?.[1];
    return candidate && (SELF_SERVE_TIER_ORDER as string[]).includes(candidate) ? (candidate as SubscriptionTier) : null;
  }

  /** TEST-ONLY — resets the org straight back to a TRIALING period
   * (clearing tier/billingCycle/cashfreeSubscriptionId too) so you can
   * re-run the checkout flow, or exercise trial-expiry behavior,
   * repeatedly while testing, without needing a fresh org every time.
   * `days` defaults to a fresh TRIAL_DAYS (30) when omitted — the
   * original behavior, unchanged for any existing caller. Passing a
   * small number (1-3) sets the trial to expire soon so the
   * dashboard's countdown banner can be watched ticking down in real
   * time; passing 0 or a negative number backdates trialEndsAt/
   * currentPeriodEnd into the past, simulating an already-expired
   * trial instantly — both are for exercising
   * SubscriptionGuard/isExpired without actually waiting. Clamped to
   * [-365, 365] purely as a sanity bound against a typo'd huge value,
   * not a product rule. Owner-only (same as every other billing
   * action), and hard-disabled the moment CASHFREE_ENV is switched to
   * PROD — this must never be reachable once real money is involved. */
  async resetToTrial(user: AuthenticatedUser, days?: number) {
    if (this.config.get<string>('CASHFREE_ENV') === 'PROD') {
      throw new ForbiddenException('This test-only action is disabled in production.');
    }
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can reset billing.');
    }
    const effectiveDays = days !== undefined && Number.isFinite(days) ? Math.max(-365, Math.min(365, Math.trunc(days))) : TRIAL_DAYS;

    const trialEndsAt = new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000);
    const org = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        subscriptionStatus: 'TRIALING',
        subscriptionTier: null,
        billingCycle: null,
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
        cashfreeSubscriptionId: null,
        cashfreeSubscriptionRef: null,
      },
      select: {
        subscriptionTier: true,
        subscriptionStatus: true,
        billingCycle: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });
    return toSubscriptionSummary(org);
  }
}
