import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Turns raw punches (+ approved leave, + holidays) into one
 * AttendanceDayRecord per employee per day — what the monthly summary
 * and Dashboard actually read. Runs nightly for "yesterday" so a full
 * day's punches are in before it's summarized; also exposed as a
 * plain method so it can be re-run for a specific date range (e.g.
 * backfilling after enrolling someone whose punches arrived unmatched).
 */
@Injectable()
export class AttendanceAggregationCronService {
  private readonly logger = new Logger(AttendanceAggregationCronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *') // 03:00 daily — summarize the day that just ended
  async runNightly(): Promise<void> {
    const yesterday = startOfDay(new Date(Date.now() - 86_400_000));
    await this.aggregateDay(yesterday);
  }

  async aggregateDay(date: Date): Promise<{ processed: number }> {
    const day = startOfDay(date);
    const nextDay = new Date(day.getTime() + 86_400_000);

    const [holidaysByOrg, employees] = await Promise.all([
      this.prisma.holiday.findMany({ where: { date: day } }),
      this.prisma.employee.findMany({ where: { status: 'ACTIVE' }, select: { id: true, organizationId: true } }),
    ]);
    const holidayOrgIds = new Set(holidaysByOrg.map((h) => h.organizationId));

    const [punches, approvedLeaves] = await Promise.all([
      this.prisma.attendancePunch.findMany({
        where: { employeeId: { not: null }, punchTime: { gte: day, lt: nextDay } },
        select: { employeeId: true, punchTime: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: LeaveStatus.APPROVED, startDate: { lte: day }, endDate: { gte: day } },
        select: { employeeId: true },
      }),
    ]);

    const onLeaveEmployeeIds = new Set(approvedLeaves.map((l) => l.employeeId));
    const punchesByEmployee = new Map<string, Date[]>();
    for (const p of punches) {
      if (!p.employeeId) continue;
      const list = punchesByEmployee.get(p.employeeId) ?? [];
      list.push(p.punchTime);
      punchesByEmployee.set(p.employeeId, list);
    }

    let processed = 0;
    for (const employee of employees) {
      if (holidayOrgIds.has(employee.organizationId)) {
        await this.upsertRecord(employee.organizationId, employee.id, day, 'HOLIDAY');
        processed++;
        continue;
      }
      if (onLeaveEmployeeIds.has(employee.id)) {
        await this.upsertRecord(employee.organizationId, employee.id, day, 'ON_LEAVE');
        processed++;
        continue;
      }
      const times = punchesByEmployee.get(employee.id);
      if (!times?.length) {
        await this.upsertRecord(employee.organizationId, employee.id, day, 'ABSENT');
        processed++;
        continue;
      }
      times.sort((a, b) => a.getTime() - b.getTime());
      const first = times[0];
      const last = times[times.length - 1];
      // A very rough half-day heuristic — under 4 hours between first
      // and last punch reads as a partial day. Good enough as a
      // starting default; a shift-hours config per role/branch would
      // make this exact, but that's a further scoping decision.
      const spanHours = (last.getTime() - first.getTime()) / 3_600_000;
      const status = spanHours < 4 ? 'HALF_DAY' : 'PRESENT';
      await this.upsertRecord(employee.organizationId, employee.id, day, status, first, last);
      processed++;
    }

    this.logger.log(`Attendance aggregation for ${day.toISOString().slice(0, 10)} — ${processed} employee-day(s) processed.`);
    return { processed };
  }

  private upsertRecord(
    organizationId: string,
    employeeId: string,
    date: Date,
    status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY',
    firstPunchAt?: Date,
    lastPunchAt?: Date,
  ) {
    return this.prisma.attendanceDayRecord.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { organizationId, employeeId, date, status, firstPunchAt, lastPunchAt },
      update: { status, firstPunchAt, lastPunchAt },
    });
  }
}
