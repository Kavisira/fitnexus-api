import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SendTemplateOptions {
  /** Destination phone number. Accepts any of the formats employees/
   * users are stored in (with or without +, spaces, leading 0) — see
   * normalizePhone below; Meta's Cloud API expects bare digits with
   * country code, e.g. 919876543210. */
  to: string;
  /** Name of the pre-approved WhatsApp template in Meta Business
   * Manager — NOT free-form text. WhatsApp's Business Platform only
   * allows business-initiated messages (anything sent outside a
   * customer's 24h reply window, which covers every notification this
   * app sends) through templates that have already gone through
   * Meta's approval process. The names here must match exactly. */
  template: string;
  language?: string;
  /** Ordered values substituted into the template's {{1}}, {{2}}, ...
   * body placeholders, in order. */
  params?: string[];
  /** Set for templates with a COPY_CODE button (the OTP template) —
   * Meta requires the code to be sent as BOTH a body parameter and a
   * button parameter, since the button is what makes the code
   * tappable-to-copy. Leave unset for templates with no button. */
  buttonCode?: string;
}

/**
 * Thin client for Meta's WhatsApp Cloud API — direct integration, no
 * BSP (RichAutomate, Gupshup, etc.) in between. One place for every
 * outbound WhatsApp send in the app — OTP delivery, leave decision
 * notices, payslip-ready notices, lead/birthday/expiry alerts — so
 * there's a single spot to add retries/logging/provider changes later
 * instead of every feature module making its own HTTP call.
 *
 * Fails soft: a WhatsApp send failure never blocks the underlying
 * action (issuing an OTP, deciding a leave request, generating a
 * payslip) — it's a notification, not the source of truth, and the
 * in-app UI already reflects the real state regardless of whether
 * the message got through. Errors are logged so delivery problems
 * are visible without becoming a 500 for the end user.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly accessToken: string | undefined;
  private readonly phoneNumberId: string | undefined;
  private readonly apiVersion: string;

  /** Meta's pre-approved, parameter-free template available on every
   * WhatsApp Business account with zero setup — used as a stand-in
   * while a real template awaits Meta business verification/approval. */
  private static readonly DEFAULT_TEST_TEMPLATE = 'hello_world';

  constructor(private config: ConfigService) {
    this.accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim() || undefined;
    this.phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim() || undefined;
    this.apiVersion = this.config.get<string>('WHATSAPP_API_VERSION')?.trim() || 'v21.0';

    if (!this.accessToken || !this.phoneNumberId) {
      this.logger.warn(
        'WHATSAPP_ACCESS_TOKEN and/or WHATSAPP_PHONE_NUMBER_ID is not set — WhatsApp sends will be skipped (logged only).',
      );
    }
  }

  /** Strips everything but digits and drops a leading 0 — Meta's
   * Cloud API expects a bare countrycode+number string, e.g.
   * "919876543210", not "+91 98765-43210" or "09876543210". Assumes
   * India (91) when a 10-digit local number is given, since that's
   * every number in this dataset today. */
  private normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    return digits.replace(/^0+/, '');
  }

  async sendTemplate(options: SendTemplateOptions): Promise<void> {
    if (!this.accessToken || !this.phoneNumberId) {
      this.logger.log(`[WhatsApp skipped — not configured] would send "${options.template}" to ${options.to}`);
      return;
    }

    const phone = this.normalizePhone(options.to);
    const params = options.params ?? [];

    // Meta's template-send payload: one "body" component carrying the
    // {{1}}, {{2}}, ... substitutions in order, plus (only for
    // templates with a COPY_CODE button, e.g. the OTP template) a
    // "button" component at index 0 carrying the same value again —
    // the button is a separate component from the body text that
    // contains it, and Meta requires both.
    const components: Record<string, unknown>[] = [];
    if (params.length) {
      components.push({
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text })),
      });
    }
    if (options.buttonCode) {
      components.push({
        type: 'button',
        sub_type: 'copy_code',
        index: '0',
        parameters: [{ type: 'coupon_code', coupon_code: options.buttonCode }],
      });
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
              name: options.template,
              language: { code: options.language ?? 'en_US' },
              ...(components.length ? { components } : {}),
            },
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`WhatsApp send failed (${response.status}) for ${phone}/${options.template}: ${body}`);
      }
    } catch (err) {
      this.logger.error(`WhatsApp send threw for ${phone}/${options.template}: ${(err as Error).message}`);
    }
  }

  /** OTP delivery — replaces SMS for the PHONE channel (see
   * OtpService.issue). Requires an approved "otp_code" Authentication
   * template in Meta Business Manager with a single {{1}} body
   * placeholder plus a COPY_CODE button; override the template name
   * via WHATSAPP_TEMPLATE_OTP if yours is named differently.
   *
   * Interim mode: until your own "otp_code" template is approved
   * (requires Meta business document verification, not yet
   * submitted), WHATSAPP_TEMPLATE_OTP can point at Meta's built-in
   * "hello_world" test template instead, so the integration can be
   * exercised end-to-end today. hello_world has no {{1}} placeholder
   * and no button, so the OTP code is NOT actually delivered via
   * WhatsApp in that mode — it's a connectivity/wiring test only.
   * The OTP itself still goes out over whichever channel actually
   * carries it (email, or the OTP_DEBUG_EXPOSE dev flag). Swap the
   * env var to your real template name once it's approved and this
   * starts sending the real code automatically — no code change
   * needed. */
  async sendOtp(phone: string, code: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_OTP') ?? 'otp_code';
    if (template === WhatsappService.DEFAULT_TEST_TEMPLATE) {
      await this.sendTemplate({ to: phone, template });
      return;
    }
    await this.sendTemplate({ to: phone, template, params: [code], buttonCode: code });
  }

  /** Leave request decided — requires an approved template (default
   * name "leave_decision") with placeholders in this order:
   * {{1}} employee name, {{2}} leave type, {{3}} APPROVED/REJECTED,
   * {{4}} decision note (or "-" if none). */
  async sendLeaveDecision(
    phone: string,
    employeeName: string,
    leaveTypeLabel: string,
    approved: boolean,
    note?: string,
  ): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_LEAVE_DECISION') ?? 'leave_decision';
    await this.sendTemplate({
      to: phone,
      template,
      params: [employeeName, leaveTypeLabel, approved ? 'Approved' : 'Rejected', note?.trim() || '-'],
    });
  }

  /** New payslip generated — requires an approved template (default
   * name "payslip_ready") with placeholders {{1}} employee name,
   * {{2}} month/year label (e.g. "September 2026"). The message tells
   * the employee to open the app to download it — this app never
   * sends the PDF itself over WhatsApp (see the payroll module's PDF
   * download endpoints), only the notification. */
  async sendPayslipReady(phone: string, employeeName: string, periodLabel: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_PAYSLIP_READY') ?? 'payslip_ready';
    await this.sendTemplate({ to: phone, template, params: [employeeName, periodLabel] });
  }

  /** Generic notification delivery — one shared template for every
   * NotificationsService.notify() call whose config has whatsappEnabled
   * on (lead assignment/overdue, birthday wishes, membership expiry
   * reminders — see notifications-cron.service.ts and leads.service.ts).
   * Deliberately generic rather than a template per notification type:
   * each approved template is a manual step in Meta Business Manager,
   * and this app's notification types will keep growing, so one
   * {{1}}=title/{{2}}=message template avoids that becoming a
   * per-feature chore. Requires an approved template (default name
   * "general_notification") with those two placeholders in order. */
  async sendNotification(phone: string, title: string, message: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_GENERIC') ?? 'general_notification';
    await this.sendTemplate({ to: phone, template, params: [title, message] });
  }

  /** A public form link (review/feedback form) just generated for a
   * member — requires an approved template (default name
   * "form_link_share") with placeholders {{1}} member name, {{2}} form
   * name, {{3}} the public URL. Same approval dependency as every
   * other template here — see WHATSAPP_TEMPLATE_OTP's doc comment for
   * the interim-testing note; this one has no hello_world equivalent
   * since every template needs its own approval regardless. */
  async sendFormLink(phone: string, memberName: string, formName: string, url: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_FORM_LINK') ?? 'form_link_share';
    await this.sendTemplate({ to: phone, template, params: [memberName, formName, url] });
  }
}
