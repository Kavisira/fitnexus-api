import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertAudienceType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  /** Every admin-side action here is Owner-only — this touches what
   * every login sees, so it's checked in the service, not left to the
   * frontend alone (unlike the Roles & Permissions matrix screen). */
  private assertOwner(role: UserRole) {
    if (role !== UserRole.OWNER) {
      throw new ForbiddenException('Only the owner can manage login alerts.');
    }
  }

  private async assertAudienceTargetValid(
    organizationId: string,
    audienceType: AlertAudienceType | undefined,
    audienceBranchId: string | null | undefined,
    audienceUserId: string | null | undefined,
  ) {
    if (audienceType === AlertAudienceType.BRANCH) {
      if (!audienceBranchId) throw new BadRequestException('A branch must be selected for a branch-targeted alert.');
      const branch = await this.prisma.branch.findFirst({ where: { id: audienceBranchId, organizationId } });
      if (!branch) throw new BadRequestException('Branch not found.');
    }
    if (audienceType === AlertAudienceType.USER) {
      if (!audienceUserId) throw new BadRequestException('A user must be selected for a user-targeted alert.');
      const user = await this.prisma.user.findFirst({ where: { id: audienceUserId, organizationId } });
      if (!user) throw new BadRequestException('User not found.');
    }
  }

  list(organizationId: string, role: UserRole) {
    this.assertOwner(role);
    return this.prisma.alert.findMany({
      where: { organizationId },
      include: {
        audienceBranch: { select: { id: true, location: true } },
        audienceUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** For the admin form's branch/user pickers. */
  async assignableTargets(organizationId: string, role: UserRole) {
    this.assertOwner(role);
    const [branches, users] = await Promise.all([
      this.prisma.branch.findMany({ where: { organizationId }, select: { id: true, location: true }, orderBy: { location: 'asc' } }),
      this.prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    ]);
    return { branches, users };
  }

  async create(organizationId: string, role: UserRole, dto: CreateAlertDto) {
    this.assertOwner(role);
    const audienceType = dto.audienceType ?? AlertAudienceType.ALL;
    await this.assertAudienceTargetValid(organizationId, audienceType, dto.audienceBranchId, dto.audienceUserId);

    return this.prisma.alert.create({
      data: {
        organizationId,
        title: dto.title,
        message: dto.message,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        isActive: dto.isActive ?? true,
        audienceType,
        audienceBranchId: audienceType === AlertAudienceType.BRANCH ? dto.audienceBranchId : null,
        audienceUserId: audienceType === AlertAudienceType.USER ? dto.audienceUserId : null,
      },
    });
  }

  async update(organizationId: string, role: UserRole, id: string, dto: UpdateAlertDto) {
    this.assertOwner(role);
    const alert = await this.prisma.alert.findFirst({ where: { id, organizationId } });
    if (!alert) {
      throw new NotFoundException('Alert not found.');
    }

    const audienceType = dto.audienceType ?? alert.audienceType;
    if (dto.audienceType !== undefined) {
      await this.assertAudienceTargetValid(organizationId, audienceType, dto.audienceBranchId, dto.audienceUserId);
    }

    return this.prisma.alert.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.message !== undefined ? { message: dto.message } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.audienceType !== undefined
          ? {
              audienceType,
              audienceBranchId: audienceType === AlertAudienceType.BRANCH ? dto.audienceBranchId : null,
              audienceUserId: audienceType === AlertAudienceType.USER ? dto.audienceUserId : null,
            }
          : {}),
      },
    });
  }

  async remove(organizationId: string, role: UserRole, id: string) {
    this.assertOwner(role);
    const alert = await this.prisma.alert.findFirst({ where: { id, organizationId } });
    if (!alert) {
      throw new NotFoundException('Alert not found.');
    }
    await this.prisma.alert.delete({ where: { id } });
    return { success: true };
  }

  /** What a logged-in user should see right now: active, within its
   * start/end window (end optional — open-ended if unset), targeted at
   * this user (ALL, or their branch, or them specifically), and not
   * already dismissed ("don't show again") by this specific user.
   * Ordered oldest-first so alerts show in a stable, predictable
   * sequence rather than jumping around. */
  async pendingForUser(organizationId: string, userId: string, branchId: string | null) {
    const now = new Date();
    return this.prisma.alert.findMany({
      where: {
        organizationId,
        isActive: true,
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
        dismissals: { none: { userId } },
        AND: [
          {
            OR: [
              { audienceType: AlertAudienceType.ALL },
              ...(branchId ? [{ audienceType: AlertAudienceType.BRANCH, audienceBranchId: branchId }] : []),
              { audienceType: AlertAudienceType.USER, audienceUserId: userId },
            ],
          },
        ],
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /** Records a permanent "don't show again" for one user on one alert.
   * A plain dismiss-for-this-session (no checkbox ticked) writes
   * nothing — the alert simply shows again next login, as intended. */
  async dismiss(userId: string, alertId: string) {
    await this.prisma.alertDismissal.upsert({
      where: { alertId_userId: { alertId, userId } },
      create: { alertId, userId },
      update: {},
    });
    return { success: true };
  }
}
