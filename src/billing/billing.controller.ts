import { BadRequestException, Body, Controller, Get, Headers, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { SubscriptionTier } from '@prisma/client';
import { CheckoutDto } from './dto/checkout.dto';
import { SelectTrialPlanDto } from './dto/select-trial-plan.dto';

@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.status(user);
  }

  // Which self-serve tiers actually fit this org's current usage —
  // drives the "this plan is too small for what you already have"
  // disabling on the trial-plan-switch screen (and the signup plan
  // picker, for a brand-new org with zero usage, where every tier is
  // eligible).
  @Get('eligible-tiers')
  @UseGuards(JwtAuthGuard)
  eligibleTiers(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.eligibleTiers(user.organizationId);
  }

  // Changes which tier a TRIALING org's trial is scoped to — see
  // BillingService.selectTrialPlan. Once the org is actually paying,
  // this 403s and /billing/checkout (upgrade-only) is the only path.
  @Post('select-trial-plan')
  @UseGuards(JwtAuthGuard)
  selectTrialPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: SelectTrialPlanDto) {
    return this.billingService.selectTrialPlan(user, dto.tier as SubscriptionTier);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.history(user);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckoutDto) {
    return this.billingService.checkout(user, dto.tier, dto.billingCycle, dto.returnOrigin);
  }

  // Called by the frontend right after /billing?checkout=return — see
  // BillingService.syncFromCashfree for why this pull is needed
  // alongside (not instead of) the webhook.
  @Post('sync')
  @UseGuards(JwtAuthGuard)
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.syncFromCashfree(user.organizationId);
  }

  // TEST-ONLY — see BillingService.resetToTrial for why this is
  // hard-disabled once CASHFREE_ENV=PROD. `days` is optional (omitted
  // means a fresh 30-day trial, the original behavior); a small
  // number or 0/negative is for exercising the near-expiry/already-
  // expired states without waiting real days — see resetToTrial's doc
  // comment. Read directly off the body (not a validated DTO) since
  // this is a single optional test knob, not a real API contract.
  @Post('reset-trial')
  @UseGuards(JwtAuthGuard)
  resetTrial(@CurrentUser() user: AuthenticatedUser, @Body('days') days?: number) {
    return this.billingService.resetToTrial(user, days !== undefined ? Number(days) : undefined);
  }

  // No auth guard — this is where Cashfree's HOSTED CHECKOUT PAGE (not
  // the server-to-server webhook below) sends the customer's own
  // browser back to once they finish paying/cancel, via a POST. GET is
  // accepted too since not every gateway flow is guaranteed to POST.
  // Either way this never trusts the request itself (no signature
  // here, unlike /webhook) — it only ever 302-redirects onward to the
  // frontend, through the same allowlisted-origin check as checkout()
  // (see BillingService.redirectUrlForReturn), so at worst a forged
  // call just gets redirected somewhere already in CORS_ORIGINS. The
  // actual subscription/tier state is never updated from this request
  // — that only ever happens from the signature-verified /webhook.
  // Nest route decorators don't stack — @Get + @Post on one method
  // only registers the LAST one applied (they apply bottom-up, so the
  // one above silently overwrites the one below's route metadata).
  // Two separate handlers, same body, is the correct way to accept
  // both methods on the same path.
  @Get('return')
  async returnGet(@Query('origin') origin: string, @Req() req: Request, @Res() res: Response) {
    await this.captureReturnOutcome(req);
    res.redirect(302, this.billingService.redirectUrlForReturn(origin));
  }

  @Post('return')
  async returnPost(@Query('origin') origin: string, @Req() req: Request, @Res() res: Response) {
    await this.captureReturnOutcome(req);
    res.redirect(302, this.billingService.redirectUrlForReturn(origin));
  }

  // Cashfree sends cf_subscriptionId/cf_checkoutStatus/cf_message as
  // either query params or a POST body (form-encoded per their docs —
  // see the urlencoded() parser added in main.ts for this exact path),
  // so this merges both rather than assuming one. Best-effort — see
  // BillingService.recordReturnOutcome, which no-ops safely if these
  // fields are absent (documented as possible in production).
  private async captureReturnOutcome(req: Request): Promise<void> {
    const params: Record<string, unknown> = { ...req.query, ...(req.body ?? {}) };
    // TEMP DIAGNOSTIC — exactly what Cashfree itself sent on the
    // checkout-return redirect (query params merged with any form body),
    // BEFORE this API does anything with it. Safe to remove once the
    // real field values/shape seen in sandbox are confirmed.
    // eslint-disable-next-line no-console
    console.log('[CASHFREE RETURN] raw params from Cashfree:', JSON.stringify(params));
    await this.billingService.recordReturnOutcome({
      cfSubscriptionId: (params['cf_subscriptionId'] as string) ?? undefined,
      checkoutStatus: (params['cf_checkoutStatus'] as string) ?? undefined,
      message: (params['cf_message'] as string) ?? undefined,
      raw: params,
    });
  }

  // No auth guard — Cashfree calls this directly, server-to-server.
  // Trust comes from the HMAC signature instead. req.rawBody is
  // populated by the dedicated raw body parser mounted on this exact
  // path in main.ts, ahead of the normal JSON body parser.
  @Post('webhook')
  async webhook(
    @Req() req: Request & { rawBody?: string },
    @Headers('x-webhook-signature') signature: string,
    @Headers('x-webhook-timestamp') timestamp: string,
  ) {
    const rawBody = req.rawBody ?? '';
    if (!signature || !timestamp || !this.billingService.verifySignature(rawBody, timestamp, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
    }
    return this.billingService.handleWebhook(req.body);
  }
}
