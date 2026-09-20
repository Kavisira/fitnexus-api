import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';

interface ComponentSnapshotRow {
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  percent: number;
  amount: number;
}

// Only the Owner can run payroll or browse everyone's payslips — same
// admin-only pattern as AlertsService/RolesService (enforced here in
// the service, not via a permission-matrix screen, since payroll is
// financial data no branch role should see org-wide by default).
function requireOwner(user: AuthenticatedUser): void {
  if (user.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only the Owner can run payroll.');
  }
}

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  /** Generates (or re-generates) one payslip per active employee for
   * the given month. LOP days come straight from that month's
   * attendance: ABSENT = 1 full LOP day, HALF_DAY = 0.5 — there's no
   * separate paid/unpaid leave-type split, matching the simplification
   * the user asked for ("just make leave that is"). Re-running for the
   * same employee/year/month overwrites the previous payslip (see the
   * unique constraint on Payslip) rather than creating a duplicate. */
  async generateForMonth(user: AuthenticatedUser, dto: GeneratePayrollDto) {
    requireOwner(user);
    const { organizationId } = user;
    const { year, month } = dto;

    const employeeWhere: Record<string, unknown> = { organizationId, status: 'ACTIVE' };
    if (dto.branchId) employeeWhere.branchId = dto.branchId;

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      include: { salaryComponents: true },
    });

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const results: { employeeId: string; employeeName: string; netPay: number }[] = [];

    for (const employee of employees) {
      const basicPay = employee.basicPay != null ? Number(employee.basicPay) : 0;

      const snapshot: ComponentSnapshotRow[] = employee.salaryComponents.map((c) => ({
        name: c.name,
        type: c.type,
        percent: Number(c.percent),
        amount: (basicPay * Number(c.percent)) / 100,
      }));
      const earnings = snapshot.filter((c) => c.type === 'EARNING').reduce((sum, c) => sum + c.amount, 0);
      const deductions = snapshot.filter((c) => c.type === 'DEDUCTION').reduce((sum, c) => sum + c.amount, 0);
      const grossEarnings = basicPay + earnings;

      const attendanceRecords = await this.prisma.attendanceDayRecord.findMany({
        where: { employeeId: employee.id, date: { gte: from, lt: to } },
        select: { status: true },
      });
      const absentDays = attendanceRecords.filter((r) => r.status === 'ABSENT').length;
      const halfDays = attendanceRecords.filter((r) => r.status === 'HALF_DAY').length;
      const lopDays = absentDays + halfDays * 0.5;
      const perDayRate = daysInMonth > 0 ? grossEarnings / daysInMonth : 0;
      const lopAmount = perDayRate * lopDays;

      const netPay = grossEarnings - deductions - lopAmount;

      const payslip = await this.prisma.payslip.upsert({
        where: { employeeId_year_month: { employeeId: employee.id, year, month } },
        create: {
          organizationId,
          employeeId: employee.id,
          year,
          month,
          basicPay,
          componentsSnapshot: snapshot as unknown as object,
          grossEarnings,
          totalDeductions: deductions,
          lopDays,
          lopAmount,
          netPay,
        },
        update: {
          basicPay,
          componentsSnapshot: snapshot as unknown as object,
          grossEarnings,
          totalDeductions: deductions,
          lopDays,
          lopAmount,
          netPay,
        },
      });

      results.push({ employeeId: employee.id, employeeName: employee.name, netPay: Number(payslip.netPay) });
    }

    return { generated: results.length, results };
  }

  /** Admin listing — every payslip for a given month, org-wide or
   * filtered to one branch/employee. Owner-only, same as generation. */
  async listForMonth(user: AuthenticatedUser, year: number, month: number, branchId?: string) {
    requireOwner(user);
    const where: Record<string, unknown> = { organizationId: user.organizationId, year, month };
    if (branchId) where.employee = { branchId };
    return this.prisma.payslip.findMany({
      where,
      include: { employee: { select: { id: true, name: true, branchId: true, branch: { select: { id: true, location: true } } } } },
      orderBy: { employee: { name: 'asc' } },
    });
  }

  /** Self-service — My Workspace's Payslips tab. No permission gate:
   * every employee can see their own payslips, same self-only pattern
   * as leave's myBalance/myRequests and attendance's myMonthly. */
  async myPayslips(user: AuthenticatedUser) {
    if (!user.employeeId) {
      return [];
    }
    return this.prisma.payslip.findMany({
      where: { employeeId: user.employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async myPayslip(user: AuthenticatedUser, id: string) {
    if (!user.employeeId) {
      throw new NotFoundException('Payslip not found.');
    }
    const payslip = await this.prisma.payslip.findFirst({ where: { id, employeeId: user.employeeId } });
    if (!payslip) {
      throw new NotFoundException('Payslip not found.');
    }
    return payslip;
  }

  /** Same lookup as myPayslip, but with the employee/branch relations
   * PayslipPdfService needs to render the document — kept separate
   * from myPayslip (which the JSON-returning /me/:id route uses) so
   * that route doesn't pull in relations it never uses. */
  async myPayslipForPdf(user: AuthenticatedUser, id: string) {
    if (!user.employeeId) {
      throw new NotFoundException('Payslip not found.');
    }
    const payslip = await this.prisma.payslip.findFirst({
      where: { id, employeeId: user.employeeId },
      include: { employee: { include: { branch: true } } },
    });
    if (!payslip) {
      throw new NotFoundException('Payslip not found.');
    }
    return payslip;
  }

  /** Admin equivalent of myPayslipForPdf — any payslip in the Owner's
   * own organization, not just their own. Owner-only, same as the rest
   * of the admin-side payroll methods. */
  async payslipForPdf(user: AuthenticatedUser, id: string) {
    requireOwner(user);
    const payslip = await this.prisma.payslip.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { employee: { include: { branch: true } } },
    });
    if (!payslip) {
      throw new NotFoundException('Payslip not found.');
    }
    return payslip;
  }

  /** Organization name/logo for the PDF header — see
   * PayslipPdfService.render. */
  async organizationForPdf(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, logoUrl: true },
    });
  }
}
