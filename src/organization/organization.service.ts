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

  /** Every logged-in user can read the org's basic identity — it's
   * display-only (name/logo for headers, generated documents, etc.),
   * not sensitive, same "self-service read" reasoning as Dashboard. */
  async mine(user: AuthenticatedUser) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, logoUrl: true },
    });
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
