import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateSubscriptionParams {
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  planName: string;
  amountInr: number;
  intervalType: 'MONTH' | 'YEAR';
  returnUrl: string;
}

export interface CashfreeSubscriptionResult {
  cfSubscriptionId: string;
  subscriptionSessionId: string;
  status: string;
}

/**
 * Thin client for Cashfree's Subscriptions API — the SaaS platform
 * billing gateway (Organization paying for FitNexus itself; NOT the
 * separate, not-yet-built member-payment flow). Mirrors
 * WhatsappService's shape: one place for every outbound Cashfree call,
 * plain `fetch`, no SDK dependency.
 *
 * Sandbox vs production is purely CASHFREE_ENV — same client code,
 * different base URL and keys (see .env.example).
 */
@Injectable()
export class CashfreeService {
  private readonly logger = new Logger(CashfreeService.name);

  constructor(private config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('CASHFREE_ENV') === 'PROD'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-version': this.config.get<string>('CASHFREE_API_VERSION') ?? '2026-01-01',
      'x-client-id': this.config.get<string>('CASHFREE_CLIENT_ID') ?? '',
      'x-client-secret': this.config.get<string>('CASHFREE_CLIENT_SECRET') ?? '',
    };
  }

  /** Creates a periodic (fixed amount, fixed interval) subscription —
   * the customer authorizes a mandate (UPI Autopay/eNACH/card) via the
   * hosted session this returns, then Cashfree auto-debits every cycle
   * until cancelled. See BillingService.checkout for how the caller
   * gets the customer to that authorization page. */
  async createSubscription(params: CreateSubscriptionParams): Promise<CashfreeSubscriptionResult> {
    const body = {
      subscription_id: params.subscriptionId,
      customer_details: {
        customer_id: params.customerId,
        customer_name: params.customerName,
        customer_email: params.customerEmail,
        customer_phone: params.customerPhone,
      },
      plan_details: {
        plan_type: 'PERIODIC',
        plan_name: params.planName.slice(0, 40),
        plan_amount: params.amountInr,
        // Cashfree requires this even for a fixed-amount PERIODIC plan
        // (it rejects the request with "plan_max_amount should not be
        // empty" otherwise) — set equal to plan_amount since every
        // charge on this plan is the same fixed amount, never more.
        plan_max_amount: params.amountInr,
        plan_currency: 'INR',
        plan_intervals: 1,
        plan_interval_type: params.intervalType,
      },
      authorization_details: {
        authorization_amount: 1,
        payment_methods: ['upi', 'card', 'enach'],
      },
      subscription_meta: {
        return_url: params.returnUrl,
        notification_channel: ['EMAIL'],
      },
    };

    const res = await fetch(`${this.baseUrl}/subscriptions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    // TEMP DIAGNOSTIC — see the matching comment in getSubscription.
    this.logger.log(`Cashfree createSubscription raw response: ${JSON.stringify(data)}`);
    if (!res.ok) {
      this.logger.error(`Cashfree createSubscription failed (${res.status}): ${JSON.stringify(data)}`);
      throw new Error(data?.message ?? 'Cashfree subscription creation failed.');
    }
    return {
      cfSubscriptionId: data.cf_subscription_id,
      subscriptionSessionId: data.subscription_session_id,
      status: data.subscription_status,
    };
  }

  /** Fetches the current state of a subscription — used after a
   * webhook or on-demand status check rather than trusting a webhook
   * alone (a missed/delayed webhook shouldn't leave the org stuck). */
  async getSubscription(cfSubscriptionId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/subscriptions/${cfSubscriptionId}`, {
      method: 'GET',
      headers: this.headers,
    });
    const data = await res.json();
    // TEMP DIAGNOSTIC — logs Cashfree's full raw response every time,
    // not just on failure, so the exact shape/status they return after
    // a sandbox "simulate success/failure" is visible without needing
    // to add print statements each time something looks off. Safe to
    // remove once the real subscription_status values seen in sandbox
    // are confirmed and handled in BillingService.syncFromCashfree.
    this.logger.log(`Cashfree getSubscription(${cfSubscriptionId}) raw response: ${JSON.stringify(data)}`);
    if (!res.ok) {
      this.logger.error(`Cashfree getSubscription failed (${res.status}): ${JSON.stringify(data)}`);
      throw new Error(data?.message ?? 'Could not fetch Cashfree subscription.');
    }
    return data;
  }

  async cancelSubscription(cfSubscriptionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/subscriptions/${cfSubscriptionId}/cancel`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      this.logger.error(`Cashfree cancelSubscription failed (${res.status}): ${JSON.stringify(data)}`);
      throw new Error(data?.message ?? 'Could not cancel Cashfree subscription.');
    }
  }
}
