import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OtpChannel, OtpPurpose, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyRegisterOtpDto } from './dto/verify-register-otp.dto';
import { ResendRegisterOtpDto } from './dto/resend-register-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private otp: OtpService,
    private jwt: JwtService,
  ) {}

  /** Step 1 of registration: create the org + a not-yet-verified user,
   * then send an OTP to both email and phone. */
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
    });
    if (existing) {
      throw new ConflictException('An account with this email or phone already exists.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        name: dto.ownerName,
        email: dto.email,
        phone: dto.phone,
        password: passwordHash,
        organization: {
          create: {
            name: dto.organizationName,
            ownerName: dto.ownerName,
            email: dto.email,
            phone: dto.phone,
            // Starts NOT_ACTIVE — flipped to ACTIVE once both the
            // email and phone OTPs are verified below.
          },
        },
      },
    });

    await Promise.all([
      this.otp.issue(user.id, OtpPurpose.SIGNUP, OtpChannel.EMAIL, dto.email),
      this.otp.issue(user.id, OtpPurpose.SIGNUP, OtpChannel.PHONE, dto.phone),
    ]);

    return { userId: user.id };
  }

  /** Step 2 of registration: verify both the email and phone OTP.
   * Both must be correct — matching the Angular signup flow, which
   * collects both codes on one screen before proceeding. */
  async verifyRegisterOtp(dto: VerifyRegisterOtpDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new BadRequestException('No pending registration found for this email.');
    }

    const [emailOk, phoneOk] = await Promise.all([
      this.otp.verify(user.id, OtpPurpose.SIGNUP, OtpChannel.EMAIL, dto.emailOtp),
      this.otp.verify(user.id, OtpPurpose.SIGNUP, OtpChannel.PHONE, dto.phoneOtp),
    ]);

    if (!emailOk || !phoneOk) {
      throw new BadRequestException('One or both verification codes are invalid or expired.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() },
      }),
      this.prisma.organization.update({
        where: { id: user.organizationId },
        data: { status: 'ACTIVE' },
      }),
    ]);

    return this.issueToken(user.id, user.email, user.organizationId, user.role, user.branchId, user.employeeId);
  }

  /** Re-sends both OTPs for a pending (not-yet-verified) registration.
   * Issuing a new code doesn't invalidate the old one server-side — the
   * OTP lookup always uses the most recently issued code, so only the
   * latest one issued (email or SMS) will actually work. */
  async resendRegisterOtp(dto: ResendRegisterOtpDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new BadRequestException('No pending registration found for this email.');
    }
    if (user.emailVerifiedAt && user.phoneVerifiedAt) {
      throw new BadRequestException('This account is already verified — please log in instead.');
    }

    await Promise.all([
      this.otp.issue(user.id, OtpPurpose.SIGNUP, OtpChannel.EMAIL, user.email),
      this.otp.issue(user.id, OtpPurpose.SIGNUP, OtpChannel.PHONE, user.phone),
    ]);

    return { message: 'New verification codes have been sent.' };
  }

  async login(dto: LoginDto) {
    const user = await this.findByIdentifier(dto.identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const orgActive = user.organization?.status === 'ACTIVE';
    if (!user.emailVerifiedAt || !user.phoneVerifiedAt || !orgActive) {
      // Distinguish this from a plain "wrong password" 401 so the
      // frontend can send the user straight to the OTP screen instead
      // of just showing an error.
      throw new UnauthorizedException({
        message: 'Please verify your email and phone before logging in.',
        requiresVerification: true,
        email: user.email,
      });
    }

    // "Remember me" unchecked → session expires in 30 minutes.
    // "Remember me" checked → session expires in 30 days.
    const expiresIn = dto.rememberMe ? '30d' : '30m';
    return this.issueToken(user.id, user.email, user.organizationId, user.role, user.branchId, user.employeeId, expiresIn);
  }

  /** Step 1 of forgot-password: look up by email or phone, send one OTP
   * to whichever channel the identifier matched. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.findByIdentifier(dto.identifier);
    // Deliberately don't reveal whether the account exists — respond
    // the same way either way, only send if it does.
    if (user) {
      const channel = EMAIL_PATTERN.test(dto.identifier) ? OtpChannel.EMAIL : OtpChannel.PHONE;
      await this.otp.issue(user.id, OtpPurpose.PASSWORD_RESET, channel, dto.identifier);
    }
    return { message: 'If that account exists, a verification code has been sent.' };
  }

  /** Step 2: check (but don't consume) the reset OTP, so the user can
   * move on to the "set new password" screen. */
  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const user = await this.findByIdentifier(dto.identifier);
    if (!user) {
      throw new BadRequestException('Invalid or expired code.');
    }

    const channel = EMAIL_PATTERN.test(dto.identifier) ? OtpChannel.EMAIL : OtpChannel.PHONE;
    const ok = await this.otp.verify(user.id, OtpPurpose.PASSWORD_RESET, channel, dto.otp, { consume: false });
    if (!ok) {
      throw new BadRequestException('Invalid or expired code.');
    }

    return { message: 'Code verified.' };
  }

  /** Step 3: re-verify (consuming this time) and set the new password —
   * matches the frontend's strong-password rule, enforced again here
   * via ResetPasswordDto's @Matches. */
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.findByIdentifier(dto.identifier);
    if (!user) {
      throw new BadRequestException('Invalid or expired code.');
    }

    const channel = EMAIL_PATTERN.test(dto.identifier) ? OtpChannel.EMAIL : OtpChannel.PHONE;
    const ok = await this.otp.verify(user.id, OtpPurpose.PASSWORD_RESET, channel, dto.otp, { consume: true });
    if (!ok) {
      throw new BadRequestException('Invalid or expired code.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { password: passwordHash } });

    return { message: 'Password updated.' };
  }

  /** The logged-in user's own basic profile — name/branch/employee link
   * — always readable regardless of the permission matrix (it's just
   * your own record, same reasoning as PermissionsService.getForRole
   * being "mine" not the full matrix). Used by screens like Leads to
   * default "assigned to" / "branch" to the current user without
   * needing to call the Branches/Employees endpoints, which a
   * screen-scoped staff login may not have read access to. */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        branch: { select: { id: true, location: true } },
        employee: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Session user no longer exists.');
    }
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      branch: user.branch,
      employeeId: user.employeeId,
      employeeName: user.employee?.name ?? null,
    };
  }

  private findByIdentifier(identifier: string) {
    // Includes the linked Organization so login() can double-check its
    // status alongside the user's own emailVerifiedAt/phoneVerifiedAt.
    return EMAIL_PATTERN.test(identifier)
      ? this.prisma.user.findUnique({ where: { email: identifier }, include: { organization: true } })
      : this.prisma.user.findUnique({ where: { phone: identifier }, include: { organization: true } });
  }

  private issueToken(
    userId: string,
    email: string,
    organizationId: string,
    role: UserRole,
    branchId: string | null,
    employeeId: string | null,
    expiresIn = '30m',
  ) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, organizationId, role, branchId, employeeId },
      { expiresIn },
    );
    return { accessToken };
  }
}
