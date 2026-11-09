import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

// Only the Owner can change the org's identity (name/logo) — same
// admin-only pattern as Payroll/Alerts/Roles & Permissions.
function requireOwner(user: AuthenticatedUser): void {
  if (user.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only the Owner can update organization settings.');
  }
}

@Injectable()
export class OrganizationService {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  /** Every logged-in user can read the org's full identity/
   * subscription snapshot — it's the "click your profile" info panel
   * (see shared/org-info-dialog on the frontend), not sensitive beyond
   * what an Owner already sees on /billing, same "self-service read"
   * reasoning as Dashboard. Includes a live branch count since that's
   * the one summary figure worth showing here that isn't already a
   * column on the row itself. */
  async mine(user: AuthenticatedUser) {
    const [org, branchCount] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: user.organizationId },
        select: {
          id: true,
          name: true,
          ownerName: true,
          email: true,
          phone: true,
          logoUrl: true,
          status: true,
          createdAt: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          billingCycle: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
        },
      }),
      this.prisma.branch.count({ where: { organizationId: user.organizationId } }),
    ]);
    return { ...org, branchCount };
  }

  /** Uploads (or replaces) the org's logo — reused everywhere the
   * org's identity appears in a generated document, starting with
   * payslip PDFs (see PayslipPdfService). */
  async uploadLogo(user: AuthenticatedUser, logoDataUrl: string) {
    requireOwner(user);
    const logoUrl = await this.s3.uploadOrgLogo(user.organizationId, logoDataUrl);
    return this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { logoUrl },
      select: { id: true, name: true, logoUrl: true },
    });
  }

  async removeLogo(user: AuthenticatedUser) {
    requireOwner(user);
    return this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { logoUrl: null },
      select: { id: true, name: true, logoUrl: true },
    });
  }
}
