import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  /** Case-insensitive/whitespace-tolerant duplicate-location check within
   * the org, scoped to whatever branch is being saved (excludeId lets an
   * edit save without tripping over its own current location). Location
   * is the branch's identifying field — there's no separate name — so
   * this is the only uniqueness that matters; address is just free-text
   * extra detail and plays no part in it. The @@unique on
   * [organizationId, location] in the schema is the authoritative
   * guard; this proactive check just gives a friendlier message before
   * that constraint would otherwise reject the write (and also catches
   * near-duplicates that differ only in case or spacing, which the DB
   * constraint alone would treat as distinct). */
  private async assertUniqueLocation(organizationId: string, location: string, excludeId?: string) {
    const norm = (v: string) => v.trim().toLowerCase();

    const candidates = await this.prisma.branch.findMany({
      where: {
        organizationId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { location: true },
    });

    const isDuplicate = candidates.some((b) => norm(b.location) === norm(location));

    if (isDuplicate) {
      throw new ConflictException('A branch already exists at this location.');
    }
  }

  /** Every query here is scoped to the caller's organizationId (from the
   * JWT, via @CurrentUser) — a branch manager/owner only ever sees their
   * own tenant's branches, matching the spec's tenant isolation model. */
  async create(organizationId: string, dto: CreateBranchDto) {
    await this.assertUniqueLocation(organizationId, dto.location);

    const existingCount = await this.prisma.branch.count({ where: { organizationId } });
    const isFirstBranch = existingCount === 0;

    // The org's very first branch is always the main branch — no
    // checkbox needed. From the second branch onward, respect whatever
    // the caller asked for.
    const isMainBranch = isFirstBranch ? true : !!dto.isMainBranch;

    if (isMainBranch && !isFirstBranch) {
      // Only one branch can be "main" at a time — demote whichever one
      // currently holds it before promoting this one.
      await this.prisma.branch.updateMany({
        where: { organizationId, isMainBranch: true },
        data: { isMainBranch: false },
      });
    }

    return this.prisma.branch.create({
      data: {
        organizationId,
        location: dto.location,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        timezone: dto.timezone ?? 'UTC',
        currency: dto.currency?.toUpperCase() ?? 'INR',
        taxRatePercent: dto.taxRatePercent,
        defaultLanguage: dto.defaultLanguage ?? 'en',
        isMainBranch,
        memberCount: dto.memberCount,
      },
    });
  }

  /** ownBranchId narrows the list to a single branch — passed for
   * staff users (Trainer/Manager/Front Desk), who only ever see their
   * own branch; the owner passes undefined and sees the whole chain. */
  findAll(organizationId: string, ownBranchId?: string | null) {
    return this.prisma.branch.findMany({
      where: { organizationId, ...(ownBranchId ? { id: ownBranchId } : {}) },
      // Main branch first, then by creation order.
      orderBy: [{ isMainBranch: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(organizationId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
    return branch;
  }

  async update(organizationId: string, id: string, dto: UpdateBranchDto) {
    // Confirms the branch belongs to this organization before writing —
    // findFirst (not findUnique) so a mismatched org can't update it.
    const branch = await this.findOne(organizationId, id);

    if (dto.location !== undefined && dto.location.trim().toLowerCase() !== branch.location.trim().toLowerCase()) {
      await this.assertUniqueLocation(organizationId, dto.location, id);
    }

    // Promoting this branch to main demotes whichever branch held it
    // before (never leaves two branches marked main at once).
    if (dto.isMainBranch === true && !branch.isMainBranch) {
      await this.prisma.branch.updateMany({
        where: { organizationId, isMainBranch: true },
        data: { isMainBranch: false },
      });
    }

    return this.prisma.branch.update({
      where: { id },
      data: {
        ...dto,
        currency: dto.currency ? dto.currency.toUpperCase() : undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    // Soft-delete via status rather than a hard DELETE — members/staff/
    // attendance records will reference branches once those modules
    // exist, and losing that history isn't desirable.
    return this.prisma.branch.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  async activate(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.branch.update({ where: { id }, data: { status: 'ACTIVE' } });
  }
}
