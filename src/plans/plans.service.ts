import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

const BRANCH_SELECT = { id: true, location: true, currency: true, taxRatePercent: true };

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  /** Confirms a branchId actually belongs to the caller's organization —
   * same pattern as LeadsService.assertBranchInOrg. */
  private async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  /** Case-insensitive/whitespace-tolerant duplicate-name check within the
   * branch, same reasoning as BranchesService.assertUniqueLocation — the
   * @@unique([branchId, name]) in the schema is the authoritative guard,
   * this just gives a friendlier message first. */
  private async assertUniqueName(branchId: string, name: string, excludeId?: string) {
    const norm = (v: string) => v.trim().toLowerCase();

    const candidates = await this.prisma.membershipPlan.findMany({
      where: { branchId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { name: true },
    });

    if (candidates.some((p) => norm(p.name) === norm(name))) {
      throw new ConflictException('A plan with this name already exists at this branch.');
    }
  }

  async create(organizationId: string, dto: CreatePlanDto) {
    await this.assertBranchInOrg(organizationId, dto.branchId);
    await this.assertUniqueName(dto.branchId, dto.name);

    return this.prisma.membershipPlan.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        price: dto.price,
        duration: dto.duration,
      },
      include: { branch: { select: BRANCH_SELECT } },
    });
  }

  /** ownBranchId narrows the list to a single branch — passed for staff
   * users (Trainer/Manager/Front Desk), who only ever see their own
   * branch's plans; the owner passes undefined/null and sees the whole
   * chain (optionally still filterable via the branchId query param). */
  findAll(organizationId: string, branchId?: string | null, ownBranchId?: string | null) {
    const effectiveBranchId = ownBranchId ?? branchId;
    return this.prisma.membershipPlan.findMany({
      where: { organizationId, ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
      include: { branch: { select: BRANCH_SELECT } },
      orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(organizationId: string, id: string) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id, organizationId },
      include: { branch: { select: BRANCH_SELECT } },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
    return plan;
  }

  async update(organizationId: string, id: string, dto: UpdatePlanDto) {
    const plan = await this.findOne(organizationId, id);

    const targetBranchId = dto.branchId ?? plan.branchId;
    if (dto.branchId && dto.branchId !== plan.branchId) {
      await this.assertBranchInOrg(organizationId, dto.branchId);
    }
    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== plan.name.trim().toLowerCase()) {
      await this.assertUniqueName(targetBranchId, dto.name, id);
    } else if (dto.branchId && dto.branchId !== plan.branchId) {
      // Branch changed but name didn't — still need to check the name
      // doesn't collide with an existing plan at the *new* branch.
      await this.assertUniqueName(targetBranchId, plan.name, id);
    }

    return this.prisma.membershipPlan.update({
      where: { id },
      data: { ...dto },
      include: { branch: { select: BRANCH_SELECT } },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.membershipPlan.delete({ where: { id } });
  }
}
