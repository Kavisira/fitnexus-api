import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin client for Resend's email API. Mirrors WhatsappService's shape
 * on purpose (same fail-soft behavior, same "skip + log if no API key"
 * pattern) so the two channels stay consistent and interchangeable
 * from NotificationsService's point of view.
 *
 * Fails soft, same reasoning as WhatsappService: an email delivery
 * failure never blocks the underlying action (issuing an OTP, raising
 * a notification) — only logs it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | undefined;
  private readonly fromAddress: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('RESEND_API_KEY')?.trim() || undefined;
    this.fromAddress = this.config.get<string>('RESEND_FROM_ADDRESS')?.trim() || 'FitNexus <onboarding@resend.dev>';

    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY is not set — email sends will be skipped (logged only).');
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.log(`[Email skipped — no API key] would send "${subject}" to ${to}`);
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ from: this.fromAddress, to: [to], subject, html }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`Email send failed (${response.status}) for ${to}: ${body}`);
      }
    } catch (err) {
      this.logger.error(`Email send threw for ${to}: ${(err as Error).message}`);
    }
  }

  /** OTP delivery for the EMAIL channel (see OtpService.issue) —
   * replaces the console.log placeholder. */
  async sendOtp(email: string, code: string): Promise<void> {
    await this.send(
      email,
      'Your FitNexus verification code',
      `<p>Your FitNexus verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>
       <p>Do not share this code with anyone.</p>`,
    );
  }

  /** Generic notification delivery — used by NotificationsService.notify()
   * when a config's emailEnabled is on and a recipient email is given
   * (lead assignment/overdue to the assigned employee, birthday wishes,
   * membership expiry reminders — see notifications-cron.service.ts). */
  async sendNotification(email: string, title: string, message: string): Promise<void> {
    await this.send(email, title, `<p>${message}</p>`);
  }
}
