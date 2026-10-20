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
  /** Default language code for every template send — must exactly
   * match the language each template was actually approved under in
   * Meta Business Manager (WhatsApp Manager > Message templates >
   * Language column), not just a generic "en_US" guess. A mismatch
   * fails with Meta error 132001 "Template name does not exist in the
   * translation" even though the template exists, just under a
   * different language code. Our templates were approved as plain
   * "en", not "en_US" — override via WHATSAPP_TEMPLATE_LANGUAGE if a
   * future template is approved under a different one. */
  private readonly defaultLanguage: string;

  /** Meta's pre-approved, parameter-free template available on every
   * WhatsApp Business account with zero setup — used as a stand-in
   * while a real template awaits Meta business verification/approval. */
  private static readonly DEFAULT_TEST_TEMPLATE = 'hello_world';

  constructor(private config: ConfigService) {
    this.accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim() || undefined;
    this.phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim() || undefined;
    this.apiVersion = this.config.get<string>('WHATSAPP_API_VERSION')?.trim() || 'v21.0';
    this.defaultLanguage = this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE')?.trim() || 'en';

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
              language: { code: options.language ?? this.defaultLanguage },
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
      // hello_world has no {{1}} placeholder, so it can't actually
      // carry the OTP code — this is a connectivity/wiring test only
      // until a real, approved "otp_code" Authentication template is
      // in place (see this method's class-level doc comment). It now
      // goes to the real logging-in user's own phone like every other
      // WhatsApp send, rather than a hardcoded test number.
      //
      // hello_world is Meta's own built-in template and is approved
      // under "English (US)" (en_US) specifically, unlike our other
      // templates (plain "English"/en, see defaultLanguage) — must be
      // overridden here or this send 404s with error 132001 same as
      // the leave_decision mismatch did.
      await this.sendTemplate({ to: phone, template, language: 'en_US' });
      return;
    }
    await this.sendTemplate({ to: phone, template, params: [code], buttonCode: code });
  }

  /** Leave request decided — requires an approved template (default
   * name "leave_decision") whose body is "Your {{1}} leave request
   * has been {{2}} by admin." — {{1}} leave type, {{2}}
   * APPROVED/REJECTED. Trimmed down from an earlier 4-placeholder
   * draft (employee name + decision note included) that Meta
   * rejected as too many variables for the message length; the
   * employee name isn't needed since this goes straight to that
   * employee's own phone, but the decision NOTE is no longer
   * conveyed over WhatsApp at all now — it's still visible in-app,
   * just not in this message. employeeName/note stay as parameters
   * here so callers don't need to change, they're just unused now. */
  async sendLeaveDecision(
    phone: string,
    _employeeName: string,
    leaveTypeLabel: string,
    approved: boolean,
    _note?: string,
  ): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_LEAVE_DECISION') ?? 'leave_decision';
    await this.sendTemplate({
      to: phone,
      template,
      params: [leaveTypeLabel, approved ? 'Approved' : 'Rejected'],
    });
  }

  /** New payslip generated — requires an approved template (default
   * name "payslip_ready") whose body is "Your payslip for {{1}} month
   * is ready. Open the app to download it." — {{1}} month/year label
   * (e.g. "September 2026"). Trimmed down from an earlier
   * 2-placeholder draft (employee name included) that Meta rejected;
   * the employee name isn't needed since this goes straight to that
   * employee's own phone. employeeName stays as a parameter here so
   * callers don't need to change, it's just unused now. This app
   * never sends the PDF itself over WhatsApp (see the payroll
   * module's PDF download endpoints), only the notification. */
  async sendPayslipReady(phone: string, _employeeName: string, periodLabel: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_PAYSLIP_READY') ?? 'payslip_ready';
    await this.sendTemplate({ to: phone, template, params: [periodLabel] });
  }

  /** Generic notification delivery — one shared template for every
   * NotificationsService.notify() call whose config has whatsappEnabled
   * on (lead assignment/overdue, birthday wishes, membership expiry
   * reminders — see notifications-cron.service.ts and leads.service.ts).
   * Deliberately generic rather than a template per notification type:
   * each approved template is a manual step in Meta Business Manager,
   * and this app's notification types will keep growing, so one
   * shared template avoids that becoming a per-feature chore.
   *
   * Requires an approved template (default name "general_notification")
   * whose body is "FitNexus update: {{1}} Please check the app for
   * more details." — a single {{1}} = message. Trimmed down from an
   * earlier 2-placeholder draft (title + message) that Meta rejected;
   * `message` already carries everything the title would have added
   * (e.g. "John was assigned to Mike."), so the title is dropped
   * entirely rather than just unused — it's not passed to
   * sendTemplate at all. `title` stays as a parameter here so callers
   * don't need to change, it's just unused now. */
  async sendNotification(phone: string, _title: string, message: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_GENERIC') ?? 'general_notification';
    await this.sendTemplate({ to: phone, template, params: [message] });
  }

  /** A public form link (review/feedback form) just generated for a
   * member — requires an approved template (default name
   * "form_link_share") whose body is "A new form "{{1}}" has been
   * shared with you. Open this link to respond: {{2}}. Thank you." —
   * {{1}} form name, {{2}} the public URL. Trimmed down from an
   * earlier 3-placeholder draft (member name included) that Meta
   * rejected; the member name isn't needed since this goes straight
   * to that member's own phone. memberName stays as a parameter here
   * so callers don't need to change, it's just unused now. Same
   * approval dependency as every other template here — see
   * WHATSAPP_TEMPLATE_OTP's doc comment for the interim-testing note;
   * this one has no hello_world equivalent since every template
   * needs its own approval regardless. */
  async sendFormLink(phone: string, _memberName: string, formName: string, url: string): Promise<void> {
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_FORM_LINK') ?? 'form_link_share';
    await this.sendTemplate({ to: phone, template, params: [formName, url] });
  }
}
