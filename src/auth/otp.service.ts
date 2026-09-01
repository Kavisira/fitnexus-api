import { Injectable } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OTP_TTL_MINUTES = 10;

// ── TEMPORARY, TESTING-ONLY ──────────────────────────────────────────
// No real SMS/email provider is wired up yet (see the console.log
// below and the TODO on `issue`), so there's no other way for whoever
// is testing register/forgot-password to actually learn the code. Every
// endpoint that issues an OTP echoes it back in its own JSON response
// under a `debugOtp` field ONLY while this flag is on — controlled by
// the OTP_DEBUG_EXPOSE env var so it's a one-line change to disable.
//
// >>> REMOVE this flag, every `debugOtp` field it gates (grep the repo
// >>> for "debugOtp"), and this whole comment block once a real
// >>> provider (Resend/SendGrid/Twilio) is integrated — shipping an
// >>> endpoint that hands back its own OTP is a security hole in any
// >>> real deployment, not just an unwanted debug leftover. <<<
export const OTP_DEBUG_EXPOSE = process.env.OTP_DEBUG_EXPOSE === 'true';

@Injectable()
export class OtpService {
  constructor(private prisma: PrismaService) {}

  /** Creates a 6-digit OTP for a user/purpose/channel, "delivers" it,
   * and returns the raw code — the caller only ever uses the return
   * value to echo it back in a `debugOtp` response field (see
   * OTP_DEBUG_EXPOSE above); it must never be logged/returned/stored
   * anywhere else once a real provider replaces the console.log below.
   * TODO: replace the console.log with real providers — e.g. Resend/
   * SendGrid for email, Twilio for SMS (see the free-deployment plan
   * doc for the recommended free-tier options during development). */
  async issue(userId: string, purpose: OtpPurpose, channel: OtpChannel, destination: string): Promise<string> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId, purpose, channel, code, expiresAt },
    });

    // eslint-disable-next-line no-console
    console.log(`[OTP] ${purpose} ${channel} code for ${destination}: ${code} (expires in ${OTP_TTL_MINUTES}m)`);

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
