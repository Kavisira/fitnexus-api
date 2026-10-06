import { Injectable } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';

const OTP_TTL_MINUTES = 10;

// ── TEMPORARY, TESTING-ONLY ──────────────────────────────────────────
// Both channels now go out for real — PHONE via WhatsApp
// (WhatsappService), EMAIL via Resend (EmailService) — but actual
// delivery still depends on provider setup that's independent of this
// code: WhatsApp needs an approved RichAutomate/Meta template and a
// working WABA connection (see WhatsappService), and EMAIL needs
// RESEND_API_KEY set (see EmailService) — until those are in place,
// each one logs instead of sending (see their classes' fail-soft
// behavior). Every endpoint that issues an OTP still echoes it back in
// its own JSON response under a `debugOtp` field ONLY while this flag
// is on — controlled by the OTP_DEBUG_EXPOSE env var.
//
// >>> REMOVE this flag and every `debugOtp` field it gates (grep the
// >>> repo for "debugOtp") once both providers are confirmed working in
// >>> production — shipping an endpoint that hands back its own OTP is
// >>> a security hole in any real deployment, not just an unwanted
// >>> debug leftover. <<<
export const OTP_DEBUG_EXPOSE = process.env.OTP_DEBUG_EXPOSE === 'true';

@Injectable()
export class OtpService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private email: EmailService,
  ) {}

  /** Creates a 6-digit OTP for a user/purpose/channel, delivers it,
   * and returns the raw code — the caller only ever uses the return
   * value to echo it back in a `debugOtp` response field while
   * OTP_DEBUG_EXPOSE is on (see above); it must never be
   * logged/returned/stored anywhere else in production.
   * TODO: EMAIL still has no real provider (Resend/SendGrid) — see
   * the free-deployment plan doc for recommended free-tier options. */
  async issue(userId: string, purpose: OtpPurpose, channel: OtpChannel, destination: string): Promise<string> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId, purpose, channel, code, expiresAt },
    });

    if (channel === OtpChannel.PHONE) {
      // Fire-and-forget from this method's point of view — sendOtp
      // itself never throws (see WhatsappService's fail-soft design),
      // so a delivery problem can't block OTP issuance.
      await this.whatsapp.sendOtp(destination, code);
    } else {
      // Same fail-soft contract as WhatsappService — see EmailService.
      await this.email.sendOtp(destination, code);
    }

    return code;
  }

  /** Checks the most recent unconsumed OTP for a user/purpose/channel.
   * By default consumes it on success (so it can't be replayed); pass
   * `consume: false` to just check validity (e.g. the "verify code"
   * step before the "set new password" step, which re-verifies and
   * consumes it atomically). */
  async verify(
    userId: string,
    purpose: OtpPurpose,
    channel: OtpChannel,
    code: string,
    options: { consume?: boolean } = {},
  ): Promise<boolean> {
    const consume = options.consume ?? true;

    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, channel, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date() || otp.code !== code) {
      return false;
    }

    if (consume) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      });
    }

    return true;
  }
}
