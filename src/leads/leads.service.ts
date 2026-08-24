import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { NotificationsService } from '../notifications/notifications.service';

const BRANCH_SELECT = { id: true, location: true };
const ASSIGNED_EMPLOYEE_SELECT = { id: true, name: true };

export interface LeadOwnership {
  userId: string;
  // Non-null only for staff logins that have a linked Employee record.
  employeeId: string | null;
}

/** Builds the Prisma `where` fragment restricting a staff member to
 * leads they created OR that are assigned to them (via their own
 * Employee record) — `undefined` (the owner) means no restriction at
 * all. Centralized here so findAll/findOne/update/remove/addActivity
 * all apply the exact same rule. */
function ownershipWhere(ownership?: LeadOwnership) {
  if (!ownership) {
    return {};
  }
  const or: Record<string, unknown>[] = [{ createdByUserId: ownership.userId }];
  if (ownership.employeeId) {
    or.push({ assignedToEmployeeId: ownership.employeeId });
  }
  return { OR: or };
}

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /** Confirms a branchId actually belongs to the caller's organization
   * before a lead is attached to it — same tenant-isolation pattern as
   * BranchesService.findOne, just inline since it's only needed here. */
  private async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  /** Confirms an employeeId actually belongs to the caller's organization
   * before a lead is assigned to them — same pattern as
   * assertBranchInOrg. Returns the employee (just id/name) so callers
   * that need the name for a notification message don't have to fetch
   * it again. */
  private async assertEmployeeInOrg(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: ASSIGNED_EMPLOYEE_SELECT,
    });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    return employee;
  }

  async create(organizationId: string, createdByUserId: string, dto: CreateLeadDto) {
    await this.assertBranchInOrg(organizationId, dto.branchId);

    let assignedEmployee: { id: string; name: string } | null = null;
    if (dto.assignedToEmployeeId) {
      assignedEmployee = await this.assertEmployeeInOrg(organizationId, dto.assignedToEmployeeId);
    }

    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        source: dto.source,
        interestedPlan: dto.interestedPlan,
        assignedToEmployeeId: dto.assignedToEmployeeId,
        createdByUserId,
        nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined,
        // Always NEW on create — status isn't accepted from the DTO.
        status: 'NEW',
      },
      include: { branch: { select: BRANCH_SELECT }, assignedToEmployee: { select: ASSIGNED_EMPLOYEE_SELECT } },
    });

    if (assignedEmployee) {
      await this.notificationsService.notify(organizationId, {
        type: 'LEAD_ASSIGNED',
        title: 'Lead assigned',
        message: `${lead.name} was assigned to ${assignedEmployee.name}.`,
        entityType: 'lead',
        entityId: lead.id,
      });
    }

    return lead;
  }

  /** Leads are chain-wide by default (owners see everything, matching
   * the spec's "owners see chain-wide data" rule) — branchId is an
   * optional filter, not a scope restriction for the owner.
   *
   * For anyone else (Trainer/Manager/Front Desk), the controller also
   * passes `ownership` — staff only ever see leads they personally
   * created OR that are assigned to them, not every lead in their
   * branch. This matters especially for a staff login that only has
   * LEADS permission (no Branches/Employees access): they still need
   * to work leads handed to them by someone else, but shouldn't see a
   * colleague's unrelated leads. */
  findAll(organizationId: string, branchId?: string, ownership?: LeadOwnership) {
    return this.prisma.lead.findMany({
      where: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...ownershipWhere(ownership),
      },
      include: {
        branch: { select: BRANCH_SELECT },
        assignedToEmployee: { select: ASSIGNED_EMPLOYEE_SELECT },
        // Just the last few notes — enough for the card/list to show a
        // "last follow-up" preview (grid) or a short recent-notes column
        // (list) without pulling the whole timeline for every lead.
        activities: { orderBy: { createdAt: 'desc' }, take: 4 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, id: string, ownership?: LeadOwnership) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, ...ownershipWhere(ownership) },
      include: {
        branch: { select: BRANCH_SELECT },
        assignedToEmployee: { select: ASSIGNED_EMPLOYEE_SELECT },
        // Most recent first — the timeline reads top-down as "latest
        // activity first", matching how a CRM follow-up log is used.
        activities: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }
    return lead;
  }

  async update(organizationId: string, id: string, dto: UpdateLeadDto, ownership?: LeadOwnership) {
    // Confirms the lead belongs to this organization (and, for staff,
    // that they created it or it's assigned to them) before writing.
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, ...ownershipWhere(ownership) },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    if (dto.branchId && dto.branchId !== lead.branchId) {
      await this.assertBranchInOrg(organizationId, dto.branchId);
    }

    let assignedEmployee: { id: string; name: string } | null = null;
    if (dto.assignedToEmployeeId) {
      assignedEmployee = await this.assertEmployeeInOrg(organizationId, dto.assignedToEmployeeId);
    }

    // Moving a lead to LOST or CONVERTED — the two "Conclude" outcomes —
    // needs a comment, enforced here rather than in the DTO since it's
    // conditional on the status being set, not on the field simply being
    // present. lostReason serves as the comment for LOST, concludeComment
    // for CONVERTED, mirroring how the "Conclude" checkbox on the frontend
    // asks for one comment regardless of which outcome is picked.
    const nextStatus = dto.status ?? lead.status;
    if (nextStatus === 'LOST') {
      const reason = dto.lostReason ?? lead.lostReason;
      if (!reason || !reason.trim()) {
        throw new BadRequestException('A reason is required when marking a lead as lost.');
      }
    }
    if (nextStatus === 'CONVERTED') {
      const comment = dto.concludeComment ?? lead.concludeComment;
      if (!comment || !comment.trim()) {
        throw new BadRequestException('A comment is required when marking a lead as converted.');
      }
    }

    const wasConcluded = lead.status === 'LOST' || lead.status === 'CONVERTED';
    const isConcluded = nextStatus === 'LOST' || nextStatus === 'CONVERTED';

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        nextFollowUpAt:
          dto.nextFollowUpAt === undefined ? undefined : dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
      },
      include: { branch: { select: BRANCH_SELECT }, assignedToEmployee: { select: ASSIGNED_EMPLOYEE_SELECT } },
    });

    // Concluding a lead (as lost or converted) automatically drops a
    // timeline entry with the comment, so the "why" is preserved in the
    // history without forcing every status change through the manual
    // note flow.
    if (dto.status === 'LOST' && lead.status !== 'LOST' && dto.lostReason) {
      await this.prisma.leadActivity.create({
        data: { leadId: id, note: `Marked as lost: ${dto.lostReason}` },
      });
    }
    if (dto.status === 'CONVERTED' && lead.status !== 'CONVERTED' && dto.concludeComment) {
      await this.prisma.leadActivity.create({
        data: { leadId: id, note: `Marked as converted: ${dto.concludeComment}` },
      });
    }
    // Unchecking "Conclude" reopens a lead — log that transition too so
    // the timeline shows it was reopened rather than just silently
    // changing status.
    if (wasConcluded && !isConcluded) {
      await this.prisma.leadActivity.create({
        data: { leadId: id, note: `Reopened lead (was ${lead.status === 'LOST' ? 'Lost' : 'Converted'}).` },
      });
    }

    // Fires on any assignment change — set for the first time or
    // reassigned to someone else. Clearing it (assignedToEmployeeId:
    // null) doesn't notify; there's nothing actionable about an
    // un-assignment.
    if (dto.assignedToEmployeeId && dto.assignedToEmployeeId !== lead.assignedToEmployeeId && assignedEmployee) {
      await this.notificationsService.notify(organizationId, {
        type: 'LEAD_ASSIGNED',
        title: 'Lead assigned',
        message: `${updated.name} was assigned to ${assignedEmployee.name}.`,
        entityType: 'lead',
        entityId: id,
      });
    }

    return updated;
  }

  async remove(organizationId: string, id: string, ownership?: LeadOwnership) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, ...ownershipWhere(ownership) },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }
    return this.prisma.lead.delete({ where: { id } });
  }

  async addActivity(organizationId: string, leadId: string, dto: CreateLeadActivityDto, ownership?: LeadOwnership) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId, ...ownershipWhere(ownership) },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found.');
    }

    const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined;

    const activity = await this.prisma.leadActivity.create({
      data: { leadId, note: dto.note, nextFollowUpAt },
    });

    // A follow-up date set alongside a note also becomes the lead's
    // current next-follow-up value — the timeline entry keeps its own
    // copy (what was scheduled at the time), while the lead itself
    // always reflects the latest one for the overdue badge.
    if (nextFollowUpAt) {
      await this.prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt } });
    }

    return activity;
  }
}
