import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Credits every active, logged-in employee's leave balance from their
 * organization's LeaveAllocationConfig on the 1st of every month. An
 * employee with no login yet (User is null) has no role to look up an
 * allocation for and is skipped — they'll start accruing once a login
 * is created for them.
 *
 * Casual and Sick accrue freely through the year and are wiped to zero
 * every January 1st by runYearlyExpiry() below (they don't carry into
 * a new year at all, so there's nothing to cap monthly). Earned is the
 * only type that carries forward indefinitely, capped at whatever
 * ceiling the Owner configured for it — that's also where a future
 * cash-encashment feature would apply, since Earned is the leave type
 * organizations typically pay out.
 */
@Injectable()
export class LeaveAllocationCronService {
  private readonly logger = new Logger(LeaveAllocationCronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 5 1 * *') // 00:05 on the 1st of every month
  async runMonthlyAllocation(): Promise<void> {
    await this.allocateForAllOrganizations();
  }

  // 00:04 on Jan 1st only — runs one hour *before* runMonthlyAllocation
  // on that same date, so a fresh year starts at 0 and then still
  // receives January's monthly Casual/Sick credit on schedule.
  @Cron('0 4 1 1 *')
  async runYearlyExpiry(): Promise<void> {
    await this.expireCasualAndSick();
  }

  /**
   * Casual and Sick leave "expire by year" — whatever's unused is
   * forfeited, not carried into the new year. Earned is deliberately
   * untouched here; it's the type meant to accumulate across years
   * (and, in orgs that do this, be cashed out).
   */
  async expireCasualAndSick(): Promise<{ reset: number }> {
    const result = await this.prisma.leaveBalance.updateMany({
      where: { leaveType: { in: ['CASUAL', 'SICK'] }, balance: { not: 0 } },
      data: { balance: 0 },
    });
    this.logger.log(`Yearly leave expiry complete — reset ${result.count} Casual/Sick balance row(s) to 0.`);
    return { reset: result.count };
  }

  async allocateForAllOrganizations(): Promise<{ credited: number }> {
    const configs = await this.prisma.leaveAllocationConfig.findMany();
    if (!configs.length) {
      return { credited: 0 };
    }

    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE', user: { isNot: null } },
      select: { id: true, organizationId: true, user: { select: { role: true } } },
    });

    let credited = 0;
    for (const employee of employees) {
      const role = employee.user?.role;
      if (!role) continue;

      const applicableConfigs = configs.filter((c) => c.organizationId === employee.organizationId && c.role === role);
      for (const config of applicableConfigs) {
        credited += await this.creditEmployee(employee.id, employee.organizationId, config);
      }
    }

    this.logger.log(`Monthly leave allocation complete — credited ${credited} balance row(s).`);
    return { credited };
  }

  /**
   * Credits every active, logged-in employee of `role` in `organizationId`
   * for a single allocation config — used right after an Owner
   * creates/updates that config, so staff see their balance update
   * immediately instead of waiting for the 1st-of-month cron. Uses the
   * exact same "add allocation, cap at carryForwardCap" logic as the
   * monthly run, just scoped to one config instead of every config.
   */
  async allocateForConfig(config: { organizationId: string; role: string; leaveType: string; monthlyAllocation: unknown; carryForwardCap: unknown }): Promise<{ credited: number }> {
    const employees = await this.prisma.employee.findMany({
      where: { organizationId: config.organizationId, status: 'ACTIVE', user: { is: { role: config.role as any } } },
      select: { id: true },
    });

    let credited = 0;
    for (const employee of employees) {
      credited += await this.creditEmployee(employee.id, config.organizationId, config as any);
    }
    return { credited };
  }

  private async creditEmployee(
    employeeId: string,
    organizationId: string,
    config: { leaveType: any; monthlyAllocation: unknown; carryForwardCap: unknown },
  ): Promise<number> {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_leaveType: { employeeId, leaveType: config.leaveType } },
    });
    const current = Number(existing?.balance ?? 0);
    // Only Earned is ever capped — it's the one type meant to carry
    // forward and accumulate. Casual/Sick accrue uncapped through the
    // year since they're wiped to 0 every January by
    // expireCasualAndSick() instead of being limited monthly.
    const newBalance =
      config.leaveType === 'EARNED' ? Math.min(current + Number(config.monthlyAllocation), Number(config.carryForwardCap)) : current + Number(config.monthlyAllocation);

    await this.prisma.leaveBalance.upsert({
      where: { employeeId_leaveType: { employeeId, leaveType: config.leaveType } },
      create: { organizationId, employeeId, leaveType: config.leaveType, balance: newBalance },
      update: { balance: newBalance },
    });
    return 1;
  }
}
