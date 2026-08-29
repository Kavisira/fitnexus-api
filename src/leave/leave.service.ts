import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus, LeaveType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { DecideLeaveDto } from './dto/decide-leave.dto';
import { UpsertAllocationConfigDto } from './dto/upsert-allocation-config.dto';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const ALL_LEAVE_TYPES: LeaveType[] = [LeaveType.CASUAL, LeaveType.SICK, LeaveType.EARNED];

// Roles a leave allocation config row can apply to — the Owner doesn't
// apply for leave through this system, so only staff roles are valid
// here (mirrors STAFF_ROLES in roles.constants.ts).
const LEAVE_ROLES: UserRole[] = [UserRole.BRANCH_MANAGER, UserRole.TRAINER, UserRole.FRONT_DESK];

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  branchId: true,
  user: { select: { id: true, role: true } },
} as const;

@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService) {}

  // ---- Allocation config (Owner-managed) ----

  listConfig(organizationId: string) {
    return this.prisma.leaveAllocationConfig.findMany({ where: { organizationId } });
  }

  async upsertConfig(organizationId: string, dto: UpsertAllocationConfigDto) {
    if (!LEAVE_ROLES.includes(dto.role)) {
      throw new BadRequestException('Leave allocation can only be configured for Branch Manager, Trainer, or Front Desk.');
    }
    if (dto.carryForwardCap < dto.monthlyAllocation) {
      throw new BadRequestException('Carry-forward cap cannot be lower than the monthly allocation.');
    }
    return this.prisma.leaveAllocationConfig.upsert({
      where: { organizationId_role_leaveType: { organizationId, role: dto.role, leaveType: dto.leaveType } },
      create: { organizationId, role: dto.role, leaveType: dto.leaveType, monthlyAllocation: dto.monthlyAllocation, carryForwardCap: dto.carryForwardCap },
      update: { monthlyAllocation: dto.monthlyAllocation, carryForwardCap: dto.carryForwardCap },
    });
  }

  // ---- Self-service: my balance / my requests ----

  private requireEmployee(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      // The Owner has no Employee record and doesn't apply for leave
      // through this system — only staff logins reach this point.
      throw new BadRequestException('Only staff accounts have a leave balance.');
    }
    return user.employeeId;
  }

  async myBalance(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const rows = await this.prisma.leaveBalance.findMany({ where: { employeeId } });
    // Always return all three types, defaulting to 0 for one that has
    // never been credited yet (e.g. a brand-new employee before the
    // next 1st-of-month cron run), rather than omitting it.
    return ALL_LEAVE_TYPES.map((leaveType) => ({
      leaveType,
      balance: Number(rows.find((r) => r.leaveType === leaveType)?.balance ?? 0),
    }));
  }

  myRequests(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    return this.prisma.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async apply(user: AuthenticatedUser, dto: ApplyLeaveDto) {
    const employeeId = this.requireEmployee(user);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new BadRequestException('End date cannot be before the start date.');
    }
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

    const balanceRow = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_leaveType: { employeeId, leaveType: dto.leaveType } },
    });
    const available = Number(balanceRow?.balance ?? 0);
    if (days > available) {
      throw new BadRequestException(`Insufficient balance — requested ${days} day(s), ${available} available.`);
    }

    return this.prisma.leaveRequest.create({
      data: {
        organizationId: user.organizationId,
        branchId: user.branchId!,
        employeeId,
        leaveType: dto.leaveType,
        startDate: start,
        endDate: end,
        days,
        reason: dto.reason,
      },
    });
  }

  async cancelMine(user: AuthenticatedUser, id: string) {
    const employeeId = this.requireEmployee(user);
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, employeeId } });
    if (!request) {
      throw new NotFoundException('Leave request not found.');
    }
    if (request.status !== LeaveStatus.PENDING) {
      throw new BadRequestException('Only a pending request can be cancelled.');
    }
    return this.prisma.leaveRequest.update({ where: { id }, data: { status: LeaveStatus.CANCELLED, decidedAt: new Date() } });
  }

  // ---- Approver-side: team requests, approve/reject ----

  /** A Branch Manager approves their own branch's Trainer/Front Desk
   * requests; the Owner approves Branch Manager requests (and can act
   * as a fallback approver for anyone, since the Owner has full access
   * everywhere by design). Nobody approves their own request. */
  private async assertCanDecide(user: AuthenticatedUser, request: { employeeId: string; branchId: string }) {
    if (user.employeeId === request.employeeId) {
      throw new ForbiddenException('You cannot approve or reject your own leave request.');
    }
    if (user.role === UserRole.OWNER) {
      return;
    }
    if (user.role === UserRole.BRANCH_MANAGER && user.branchId === request.branchId) {
      const employee = await this.prisma.employee.findUnique({ where: { id: request.employeeId }, select: EMPLOYEE_SELECT });
      if (employee?.user?.role === UserRole.BRANCH_MANAGER) {
        throw new ForbiddenException('Branch Managers are approved by the Owner.');
      }
      return;
    }
    throw new ForbiddenException('You are not authorized to decide this leave request.');
  }

  /** ownBranchId (a Branch Manager's single assigned branch) always
   * wins over an explicit branchId filter — same scoping pattern used
   * by Expenses/Leads/Branches. The Owner sees every branch. */
  listTeamRequests(organizationId: string, ownBranchId: string | null | undefined, status?: LeaveStatus, branchId?: string) {
    const effectiveBranchId = ownBranchId ?? branchId;
    return this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(status ? { status } : {}),
      },
      include: { employee: { select: { id: true, name: true, photoUrl: true } }, branch: { select: { id: true, location: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decide(user: AuthenticatedUser, id: string, approve: boolean, dto: DecideLeaveDto) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!request) {
        throw new NotFoundException('Leave request not found.');
      }
      if (request.status !== LeaveStatus.PENDING) {
        throw new BadRequestException('This request has already been decided.');
      }
      await this.assertCanDecide(user, request);

      if (approve) {
        const balanceRow = await tx.leaveBalance.findUnique({
          where: { employeeId_leaveType: { employeeId: request.employeeId, leaveType: request.leaveType } },
        });
        const available = Number(balanceRow?.balance ?? 0);
        if (Number(request.days) > available) {
          throw new BadRequestException('Employee no longer has sufficient balance for this request.');
        }
        await tx.leaveBalance.update({
          where: { employeeId_leaveType: { employeeId: request.employeeId, leaveType: request.leaveType } },
          data: { balance: { decrement: request.days } },
        });
      }

      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: approve ? LeaveStatus.APPROVED : LeaveStatus.REJECTED,
          approverUserId: user.userId,
          decisionNote: dto.decisionNote,
          decidedAt: new Date(),
        },
      });
    });
  }
}
