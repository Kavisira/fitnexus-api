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
 * Balance after credit is capped at carryForwardCap, so unused leave
 * from the prior month still carries forward but doesn't grow past
 * whatever ceiling the Owner configured (equal to monthlyAllocation
 * means "no carry-forward" — every month resets to exactly the fresh
 * allocation, never higher than that).
 */
@Injectable()
export class LeaveAllocationCronService {
  private readonly logger = new Logger(LeaveAllocationCronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 5 1 * *') // 00:05 on the 1st of every month
  async runMonthlyAllocation(): Promise<void> {
    await this.allocateForAllOrganizations();
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
        const existing = await this.prisma.leaveBalance.findUnique({
          where: { employeeId_leaveType: { employeeId: employee.id, leaveType: config.leaveType } },
        });
        const current = Number(existing?.balance ?? 0);
        const cap = Number(config.carryForwardCap);
        const newBalance = Math.min(current + Number(config.monthlyAllocation), cap);

        await this.prisma.leaveBalance.upsert({
          where: { employeeId_leaveType: { employeeId: employee.id, leaveType: config.leaveType } },
          create: { organizationId: employee.organizationId, employeeId: employee.id, leaveType: config.leaveType, balance: newBalance },
          update: { balance: newBalance },
        });
        credited++;
      }
    }

    this.logger.log(`Monthly leave allocation complete — credited ${credited} balance row(s).`);
    return { credited };
  }
}
