import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PlatformExpenseFrequency, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TIER_MONTHLY_PRICE_INR } from '../billing/billing.constants';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { CreatePlatformExpenseDto, UpdatePlatformExpenseDto } from './dto/platform-expense.dto';

// Subscription statuses counted as "paying, in good standing" for the
// MRR estimate below — TRIALING orgs contribute $0 (no charge has
// happened yet), PAST_DUE/CANCELLED/EXPIRED are excluded the same way
// a real MRR figure would exclude anyone not currently being billed.
const MRR_ELIGIBLE_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE];

// Statuses that mean "this org finished its trial and left" — the
// denominator for trial→paid conversion and the churn count both read
// off this set (see below).
const CHURNED_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED];

const DAYS_IN_TREND = 30;

@Injectable()
export class PlatformAdminService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: PlatformAdminLoginDto) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const ok = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    const token = await this.jwt.signAsync(
      { sub: admin.id, email: admin.email, type: 'platform-admin' },
      { expiresIn: '12h' },
    );
    return { accessToken: token, email: admin.email };
  }

  async overview() {
    const now = new Date();
    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - (DAYS_IN_TREND - 1));
    trendStart.setHours(0, 0, 0, 0);

    const prev7Start = new Date(now);
    prev7Start.setDate(prev7Start.getDate() - 14);
    const last7Start = new Date(now);
    last7Start.setDate(last7Start.getDate() - 7);

    const [
      totalOrganizations,
      byStatusRaw,
      byTierRaw,
      bySubStatusRaw,
      orgsCreatedInTrend,
      signupsLast7Days,
      signupsPrev7Days,
      activeOrgsForMrr,
      churnedRecently,
      checkoutEventsRaw,
      recentOrganizations,
      allExpenses,
      trialingByTierRaw,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.organization.groupBy({ by: ['subscriptionTier'], _count: { _all: true } }),
      this.prisma.organization.groupBy({ by: ['subscriptionStatus'], _count: { _all: true } }),
      this.prisma.organization.findMany({
        where: { createdAt: { gte: trendStart } },
        select: { createdAt: true },
      }),
      this.prisma.organization.count({ where: { createdAt: { gte: last7Start } } }),
      this.prisma.organization.count({ where: { createdAt: { gte: prev7Start, lt: last7Start } } }),
      this.prisma.organization.findMany({
        where: { subscriptionStatus: { in: MRR_ELIGIBLE_STATUSES } },
        select: { subscriptionTier: true, billingCycle: true },
      }),
      // Heuristic: an org currently in a churned status whose row was
      // last touched within the trend window — updatedAt isn't a
      // dedicated "churned at" timestamp, but status flips are what
      // bump it in practice, so this is a reasonable approximation
      // without adding a new column.
      this.prisma.organization.count({
        where: { subscriptionStatus: { in: CHURNED_STATUSES }, updatedAt: { gte: trendStart } },
      }),
      this.prisma.subscriptionEvent.findMany({
        where: { source: 'CHECKOUT', createdAt: { gte: trendStart } },
        select: { eventType: true },
      }),
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          name: true,
          ownerName: true,
          email: true,
          status: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          createdAt: true,
          _count: { select: { branches: true, members: true, employees: true } },
        },
      }),
      this.prisma.platformExpense.findMany({ orderBy: { incurredAt: 'desc' } }),
      // Per-tier breakdown of orgs still TRIALING on that plan — backs
      // the plan-wise KPI cards' "X trialing" line, kept separate from
      // activePayingByTier so a trialing org is never shown as if it
      // were already a paying customer of that plan.
      this.prisma.organization.groupBy({
        by: ['subscriptionTier'],
        where: { subscriptionStatus: 'TRIALING' },
        _count: { _all: true },
      }),
    ]);

    // Running-the-business costs — see PlatformExpense's own doc
    // comment. ANNUAL contributes its amount/12 to the MONTHLY
    // recurring total (same monthly-equivalent treatment as the MRR
    // calc above); ONE_TIME entries (a dev invoice, a one-off ad
    // campaign) are lifetime spend, not a recurring monthly cost, so
    // they're kept in their own total rather than netted against MRR.
    let monthlyRecurringExpenseInr = 0;
    let totalOneTimeExpenseInr = 0;
    const expenseByCategory = new Map<string, number>();
    for (const e of allExpenses) {
      const amount = Number(e.amountInr);
      const monthlyEquivalent =
        e.frequency === PlatformExpenseFrequency.MONTHLY
          ? amount
          : e.frequency === PlatformExpenseFrequency.ANNUAL
            ? amount / 12
            : 0;
      monthlyRecurringExpenseInr += monthlyEquivalent;
      if (e.frequency === PlatformExpenseFrequency.ONE_TIME) {
        totalOneTimeExpenseInr += amount;
      }
      // Category breakdown uses the same monthly-equivalent treatment
      // for recurring rows, and the raw amount for one-time rows, so
      // "where does the monthly burn go" and "what have we sunk into
      // DEVELOPMENT lifetime" are both readable from one map without a
      // second query — the frontend splits ONE_TIME-heavy categories
      // (typically DEVELOPMENT) out of the recurring pie itself.
      const key = e.category;
      expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + (e.frequency === PlatformExpenseFrequency.ONE_TIME ? amount : monthlyEquivalent));
    }

    // Daily signup trend — a zero-filled bucket per day so the chart
    // doesn't have to guess at gaps (a day with zero signups must still
    // appear as 0, not be missing from the series).
    const dayBuckets = new Map<string, number>();
    for (let i = 0; i < DAYS_IN_TREND; i++) {
      const d = new Date(trendStart);
      d.setDate(d.getDate() + i);
      dayBuckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const org of orgsCreatedInTrend) {
      const key = org.createdAt.toISOString().slice(0, 10);
      dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1);
    }
    const signupTrend = Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count }));

    // Checkout funnel for the same trend window — every CHECKOUT_STARTED
    // row is an attempt; CHECKOUT_FAILED/CHECKOUT_RETURN_FAILED are
    // attempts that didn't convert. "Converted" is inferred as
    // started-minus-failed rather than matched 1:1 to a webhook
    // activation, since a successful checkout's confirmation arrives as
    // a separate WEBHOOK-sourced row, not a CHECKOUT-sourced one.
    let checkoutStarted = 0;
    let checkoutFailed = 0;
    for (const e of checkoutEventsRaw) {
      if (e.eventType === 'CHECKOUT_STARTED') checkoutStarted++;
      else if (e.eventType === 'CHECKOUT_FAILED' || e.eventType === 'CHECKOUT_RETURN_FAILED') checkoutFailed++;
    }

    // MRR estimate — annual-billed orgs contribute their monthly-
    // equivalent (annual price / 12), not the full annual charge.
    // mrrByTier/activePayingByTier back the per-plan KPI cards on the
    // dashboard — same monthly-equivalent treatment, just bucketed.
    let mrrInr = 0;
    const mrrByTier = new Map<string, number>();
    const activePayingByTier = new Map<string, number>();
    for (const org of activeOrgsForMrr) {
      if (!org.subscriptionTier) continue;
      const monthly = TIER_MONTHLY_PRICE_INR[org.subscriptionTier];
      activePayingByTier.set(org.subscriptionTier, (activePayingByTier.get(org.subscriptionTier) ?? 0) + 1);
      if (monthly === null) continue; // ENTERPRISE — no listed price, not counted
      const contribution = org.billingCycle === 'ANNUAL' ? (monthly * 10) / 12 : monthly;
      mrrInr += contribution;
      mrrByTier.set(org.subscriptionTier, (mrrByTier.get(org.subscriptionTier) ?? 0) + contribution);
    }

    const activePayingCount = activeOrgsForMrr.length;
    const arpaInr = activePayingCount > 0 ? Math.round(mrrInr / activePayingCount) : 0;

    const subStatusCounts = Object.fromEntries(bySubStatusRaw.map((r) => [r.subscriptionStatus, r._count._all])) as Record<
      string,
      number
    >;
    const trialing = subStatusCounts['TRIALING'] ?? 0;
    const everLeftTrial = activePayingCount + (subStatusCounts['PAST_DUE'] ?? 0) + (subStatusCounts['CANCELLED'] ?? 0) + (subStatusCounts['EXPIRED'] ?? 0);
    const trialToPaidRate = everLeftTrial > 0 ? Math.round((activePayingCount / everLeftTrial) * 1000) / 10 : null;

    const signupWowDeltaPct =
      signupsPrev7Days > 0
        ? Math.round(((signupsLast7Days - signupsPrev7Days) / signupsPrev7Days) * 1000) / 10
        : signupsLast7Days > 0
          ? 100
          : 0;

    return {
      totalOrganizations,
      byStatus: Object.fromEntries(byStatusRaw.map((r) => [r.status, r._count._all])),
      byTier: Object.fromEntries(byTierRaw.map((r) => [r.subscriptionTier ?? 'UNSET', r._count._all])),
      bySubscriptionStatus: subStatusCounts,
      signupsLast30Days: orgsCreatedInTrend.length,
      signupsLast7Days,
      signupWowDeltaPct,
      signupTrend,
      checkoutFunnel: {
        started: checkoutStarted,
        failed: checkoutFailed,
        converted: Math.max(0, checkoutStarted - checkoutFailed),
      },
      mrrInr: Math.round(mrrInr),
      mrrByTier: Object.fromEntries(Array.from(mrrByTier.entries()).map(([k, v]) => [k, Math.round(v)])),
      activePayingByTier: Object.fromEntries(activePayingByTier.entries()),
      trialingByTier: Object.fromEntries(
        trialingByTierRaw.filter((r) => r.subscriptionTier).map((r) => [r.subscriptionTier as string, r._count._all]),
      ),
      arpaInr,
      activePayingCount,
      trialingCount: trialing,
      trialToPaidRate,
      churnedLast30Days: churnedRecently,
      monthlyRecurringExpenseInr: Math.round(monthlyRecurringExpenseInr),
      totalOneTimeExpenseInr: Math.round(totalOneTimeExpenseInr),
      monthlyProfitInr: Math.round(mrrInr - monthlyRecurringExpenseInr),
      expenseByCategory: Object.fromEntries(Array.from(expenseByCategory.entries()).map(([k, v]) => [k, Math.round(v)])),
      recentOrganizations: recentOrganizations.map((o) => ({
        id: o.id,
        name: o.name,
        ownerName: o.ownerName,
        email: o.email,
        status: o.status,
        subscriptionTier: o.subscriptionTier,
        subscriptionStatus: o.subscriptionStatus,
        createdAt: o.createdAt,
        branchCount: o._count.branches,
        memberCount: o._count.members,
        employeeCount: o._count.employees,
      })),
    };
  }

  // ---- Detail-list drill-downs for the clickable KPI widgets on the
  // overview dashboard. Each segment key corresponds to one card or
  // breakdown row; "prefixed" segments (status:/tier:/substatus:) back
  // the per-value rows inside the three breakdown lists.
  async organizationsBySegment(segment: string) {
    const now = new Date();
    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - (DAYS_IN_TREND - 1));
    trendStart.setHours(0, 0, 0, 0);
    const last7Start = new Date(now);
    last7Start.setDate(last7Start.getDate() - 7);

    let where: Record<string, unknown> = {};
    if (segment === 'all') {
      where = {};
    } else if (segment === 'signups7') {
      where = { createdAt: { gte: last7Start } };
    } else if (segment === 'signups30') {
      where = { createdAt: { gte: trendStart } };
    } else if (segment === 'trialing') {
      where = { subscriptionStatus: 'TRIALING' };
    } else if (segment === 'activePaying') {
      where = { subscriptionStatus: { in: MRR_ELIGIBLE_STATUSES } };
    } else if (segment === 'churned30') {
      // Same heuristic as the churnedLast30Days count in overview().
      where = { subscriptionStatus: { in: CHURNED_STATUSES }, updatedAt: { gte: trendStart } };
    } else if (segment.startsWith('status:')) {
      where = { status: segment.slice('status:'.length) };
    } else if (segment.startsWith('tier:')) {
      const tier = segment.slice('tier:'.length);
      where = tier === 'UNSET' ? { subscriptionTier: null } : { subscriptionTier: tier };
    } else if (segment.startsWith('substatus:')) {
      where = { subscriptionStatus: segment.slice('substatus:'.length) };
    } else {
      where = {};
    }

    const organizations = await this.prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        ownerName: true,
        email: true,
        status: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        billingCycle: true,
        createdAt: true,
        _count: { select: { branches: true, members: true, employees: true } },
      },
    });

    return organizations.map((o) => ({
      id: o.id,
      name: o.name,
      ownerName: o.ownerName,
      email: o.email,
      status: o.status,
      subscriptionTier: o.subscriptionTier,
      subscriptionStatus: o.subscriptionStatus,
      billingCycle: o.billingCycle,
      createdAt: o.createdAt,
      branchCount: o._count.branches,
      memberCount: o._count.members,
      employeeCount: o._count.employees,
    }));
  }

  // Checkout-funnel drill-down — joins each SubscriptionEvent row with
  // its organization so the detail list reads as "who attempted
  // checkout", not just raw event rows. "converted" is approximated
  // the same way the funnel count itself is approximated in
  // overview() (see that comment) — started events whose organization
  // is currently in a paying status — since a successful checkout's
  // confirmation lands as a separate WEBHOOK-sourced row, not matched
  // 1:1 to the CHECKOUT-sourced start event.
  async checkoutEventsByOutcome(outcome: string) {
    const now = new Date();
    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - (DAYS_IN_TREND - 1));
    trendStart.setHours(0, 0, 0, 0);

    const events = await this.prisma.subscriptionEvent.findMany({
      where: { source: 'CHECKOUT', createdAt: { gte: trendStart } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventType: true,
        createdAt: true,
        organization: {
          select: { id: true, name: true, ownerName: true, email: true, subscriptionStatus: true },
        },
      },
    });

    let filtered = events;
    if (outcome === 'started') {
      filtered = events.filter((e) => e.eventType === 'CHECKOUT_STARTED');
    } else if (outcome === 'failed') {
      filtered = events.filter((e) => e.eventType === 'CHECKOUT_FAILED' || e.eventType === 'CHECKOUT_RETURN_FAILED');
    } else if (outcome === 'converted') {
      filtered = events.filter(
        (e) =>
          e.eventType === 'CHECKOUT_STARTED' &&
          e.organization &&
          (MRR_ELIGIBLE_STATUSES as string[]).includes(e.organization.subscriptionStatus),
      );
    }

    return filtered.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt,
      organizationId: e.organization?.id ?? null,
      organizationName: e.organization?.name ?? null,
      ownerName: e.organization?.ownerName ?? null,
      email: e.organization?.email ?? null,
      subscriptionStatus: e.organization?.subscriptionStatus ?? null,
    }));
  }

  // ---- Platform expenses CRUD — single-admin, no ownership checks
  // beyond PlatformAdminJwtGuard itself (there's only ever one kind of
  // caller here). ----

  listExpenses() {
    return this.prisma.platformExpense.findMany({ orderBy: { incurredAt: 'desc' } });
  }

  createExpense(dto: CreatePlatformExpenseDto) {
    return this.prisma.platformExpense.create({
      data: {
        category: dto.category,
        label: dto.label,
        amountInr: dto.amountInr,
        frequency: dto.frequency,
        incurredAt: new Date(dto.incurredAt),
        notes: dto.notes,
      },
    });
  }

  updateExpense(id: string, dto: UpdatePlatformExpenseDto) {
    return this.prisma.platformExpense.update({
      where: { id },
      data: {
        category: dto.category,
        label: dto.label,
        amountInr: dto.amountInr,
        frequency: dto.frequency,
        incurredAt: new Date(dto.incurredAt),
        notes: dto.notes,
      },
    });
  }

  deleteExpense(id: string) {
    return this.prisma.platformExpense.delete({ where: { id } });
  }
}
