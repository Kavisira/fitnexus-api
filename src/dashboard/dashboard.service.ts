import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Roles that see the full owner/manager analytics view (revenue,
 * expenses, leads pipeline). Every other logged-in role (Trainer,
 * Front Desk, and anything else that isn't wired up for login yet)
 * gets the narrower day-to-day ops view instead — see getSummary. */
const ANALYTICS_ROLES: UserRole[] = [UserRole.OWNER, UserRole.BRANCH_MANAGER];

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary(user: AuthenticatedUser, branchId: string | null) {
    if (ANALYTICS_ROLES.includes(user.role)) {
      return this.getAnalyticsSummary(user.organizationId, branchId);
    }
    return this.getOpsSummary(user.organizationId, branchId, user.employeeId);
  }

  // ---- Owner / Branch Manager: full business analytics ----

  private async getAnalyticsSummary(organizationId: string, branchId: string | null) {
    const now = new Date();
    const months = this.lastNMonths(now, 6);
    const branchWhere = branchId ? { branchId } : {};

    const [members, expenses, leads, organization, branchCount, employeeCount, activeEmployeeCount] = await Promise.all([
      this.prisma.member.findMany({
        where: { organizationId, ...branchWhere },
        select: { status: true, branchId: true, startDate: true, endDate: true, price: true, plan: { select: { name: true } } },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, ...branchWhere },
        select: { branchId: true, category: true, amount: true, expenseDate: true },
      }),
      this.prisma.lead.findMany({
        where: { organizationId, ...branchWhere },
        select: { status: true, createdAt: true },
      }),
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      this.prisma.branch.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.employee.count({ where: { organizationId, ...branchWhere } }),
      this.prisma.employee.count({ where: { organizationId, ...branchWhere, status: 'ACTIVE' } }),
    ]);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const activeMembers = members.filter((m) => m.status === 'ACTIVE');
    const newThisMonth = members.filter((m) => m.startDate >= monthStart).length;
    const expiringIn7 = activeMembers.filter((m) => m.endDate >= now && m.endDate <= in7Days).length;
    const expiringIn30 = activeMembers.filter((m) => m.endDate >= now && m.endDate <= in30Days).length;

    const signupSeries = months.map(({ start, end, label }) => ({
      label,
      count: members.filter((m) => m.startDate >= start && m.startDate < end).length,
    }));

    const revenueSeries = months.map(({ start, end, label }) => ({
      label,
      amount: members
        .filter((m) => m.startDate >= start && m.startDate < end)
        .reduce((sum, m) => sum + Number(m.price), 0),
    }));

    const expenseSeries = months.map(({ start, end, label }) => ({
      label,
      amount: expenses
        .filter((e) => e.expenseDate >= start && e.expenseDate < end)
        .reduce((sum, e) => sum + Number(e.amount), 0),
    }));

    const netProfitSeries = months.map((_, i) => ({
      label: months[i].label,
      amount: revenueSeries[i].amount - expenseSeries[i].amount,
    }));

    const revenueByPlan = this.groupSum(
      activeMembers.map((m) => ({ key: m.plan?.name ?? 'No plan', value: Number(m.price) })),
    );

    const expensesByCategory = this.groupSum(
      expenses
        .filter((e) => e.expenseDate >= monthStart)
        .map((e) => ({ key: e.category, value: Number(e.amount) })),
    );

    const leadsByStatus = this.groupSum(leads.map((l) => ({ key: l.status, value: 1 })));
    const convertedCount = leads.filter((l) => l.status === 'CONVERTED').length;
    const lostCount = leads.filter((l) => l.status === 'LOST').length;
    const concludedCount = convertedCount + lostCount;
    const conversionRate = concludedCount > 0 ? Math.round((convertedCount / concludedCount) * 1000) / 10 : 0;
    const newLeadsThisMonth = leads.filter((l) => l.createdAt >= monthStart).length;

    // Only meaningful org-wide (no single branch selected) — a per-
    // branch manager viewing their own branch already sees everything
    // in the cards above, a breakdown of one branch would be redundant.
    const branchBreakdown = branchId
      ? []
      : await this.buildBranchBreakdown(organizationId, members, expenses, monthStart);

    return {
      view: 'ANALYTICS' as const,
      organization: {
        name: organization?.name ?? '',
        totalBranches: branchCount,
        totalEmployees: employeeCount,
        activeEmployees: activeEmployeeCount,
      },
      members: {
        activeCount: activeMembers.length,
        newThisMonth,
        expiringIn7,
        expiringIn30,
        signupSeries,
      },
      finance: {
        revenueThisMonth: revenueSeries[revenueSeries.length - 1]?.amount ?? 0,
        expensesThisMonth: expenseSeries[expenseSeries.length - 1]?.amount ?? 0,
        netProfitThisMonth: netProfitSeries[netProfitSeries.length - 1]?.amount ?? 0,
        revenueSeries,
        expenseSeries,
        netProfitSeries,
        revenueByPlan,
        expensesByCategory,
      },
      leads: {
        total: leads.length,
        newThisMonth: newLeadsThisMonth,
        conversionRate,
        byStatus: leadsByStatus,
      },
      branchBreakdown,
    };
  }

  /** Per-branch rollup shown as a table under the charts when the owner
   * is viewing the whole organization (no branchId filter) — lets them
   * see at a glance which branch is carrying the org rather than only
   * the summed totals above. */
  private async buildBranchBreakdown(
    organizationId: string,
    members: { branchId: string; status: string; startDate: Date; price: unknown }[],
    expenses: { branchId: string; amount: unknown; expenseDate: Date }[],
    monthStart: Date,
  ) {
    const branches = await this.prisma.branch.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, location: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });

    return branches.map((b) => {
      const branchMembers = members.filter((m) => m.branchId === b.id);
      const activeCount = branchMembers.filter((m) => m.status === 'ACTIVE').length;
      const revenueThisMonth = branchMembers
        .filter((m) => m.startDate >= monthStart)
        .reduce((sum, m) => sum + Number(m.price), 0);
      const expensesThisMonth = expenses
        .filter((e) => e.branchId === b.id && e.expenseDate >= monthStart)
        .reduce((sum, e) => sum + Number(e.amount), 0);

      return {
        branchId: b.id,
        location: b.location,
        currency: b.currency,
        activeMembers: activeCount,
        revenueThisMonth,
        expensesThisMonth,
      };
    });
  }

  // ---- Trainer / Front Desk: narrow day-to-day ops view, no money ----

  private async getOpsSummary(organizationId: string, branchId: string | null, employeeId: string | null) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const branchWhere = branchId ? { branchId } : {};

    const [todaysCheckins, expiringSoon, attentionMembers, followUps] = await Promise.all([
      this.prisma.memberMetricEntry.count({
        where: {
          recordedAt: { gte: todayStart, lt: todayEnd },
          member: { organizationId, ...branchWhere },
        },
      }),
      this.prisma.member.count({
        where: { organizationId, ...branchWhere, status: 'ACTIVE', endDate: { gte: now, lte: in7Days } },
      }),
      this.prisma.member.findMany({
        where: { organizationId, ...branchWhere, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          metricEntries: { orderBy: { recordedAt: 'desc' as const }, take: 1 },
        },
        take: 100,
      }),
      this.prisma.lead.findMany({
        where: {
          organizationId,
          ...branchWhere,
          status: { notIn: ['CONVERTED', 'LOST'] },
          nextFollowUpAt: { lte: todayEnd },
          ...(employeeId ? { assignedToEmployeeId: employeeId } : {}),
        },
        select: { id: true, name: true, phone: true, status: true, nextFollowUpAt: true },
        orderBy: { nextFollowUpAt: 'asc' },
        take: 10,
      }),
    ]);

    const bmiHighlights = attentionMembers
      .map((m) => ({ id: m.id, name: m.name, latest: m.metricEntries[0] }))
      .filter((m) => m.latest && (m.latest.bmiStatus === 'UNDERWEIGHT' || m.latest.bmiStatus === 'OBESE'))
      .slice(0, 8)
      .map((m) => ({ id: m.id, name: m.name, bmi: Number(m.latest!.bmi), bmiStatus: m.latest!.bmiStatus }));

    return {
      view: 'OPS' as const,
      todaysCheckins,
      expiringSoon,
      bmiHighlights,
      followUps: followUps.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        status: l.status,
        nextFollowUpAt: l.nextFollowUpAt,
      })),
    };
  }

  // ---- helpers ----

  private lastNMonths(now: Date, n: number): { start: Date; end: Date; label: string }[] {
    const result: { start: Date; end: Date; label: string }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      result.push({ start, end, label: MONTH_LABELS[start.getMonth()] });
    }
    return result;
  }

  private groupSum(items: { key: string; value: number }[]): { key: string; value: number }[] {
    const map = new Map<string, number>();
    for (const { key, value } of items) {
      map.set(key, (map.get(key) ?? 0) + value);
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  }
}
