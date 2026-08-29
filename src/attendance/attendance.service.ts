import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  /** Today's snapshot: how many staff are present/absent/half-day/on-leave
   * today (from the nightly-aggregated AttendanceDayRecord, if it has run
   * for today already — otherwise falls back to raw punches for a live
   * count), plus how many member swipe-ins happened today per branch. */
  async todaySnapshot(organizationId: string, branchId?: string) {
    const day = startOfDay(new Date());
    const nextDay = new Date(day.getTime() + 86_400_000);

    const employeeWhere: any = { organizationId, status: 'ACTIVE' };
    if (branchId) employeeWhere.branchId = branchId;

    const [employees, dayRecords, memberPunchesToday] = await Promise.all([
      this.prisma.employee.findMany({ where: employeeWhere, select: { id: true, name: true, branchId: true } }),
      this.prisma.attendanceDayRecord.findMany({
        where: { organizationId, date: day },
      }),
      this.prisma.attendancePunch.findMany({
        where: {
          organizationId,
          personType: 'MEMBER',
          punchTime: { gte: day, lt: nextDay },
          ...(branchId ? { branchId } : {}),
        },
        select: { memberId: true, branchId: true },
      }),
    ]);

    const employeeIds = new Set(employees.map((e) => e.id));
    const recordsByEmployee = new Map(dayRecords.filter((r) => employeeIds.has(r.employeeId)).map((r) => [r.employeeId, r]));

    let present = 0;
    let absent = 0;
    let halfDay = 0;
    let onLeave = 0;
    let holiday = 0;
    let notYetAggregated = 0;

    for (const emp of employees) {
      const record = recordsByEmployee.get(emp.id);
      if (!record) {
        notYetAggregated++;
        continue;
      }
      switch (record.status) {
        case 'PRESENT':
          present++;
          break;
        case 'ABSENT':
          absent++;
          break;
        case 'HALF_DAY':
          halfDay++;
          break;
        case 'ON_LEAVE':
          onLeave++;
          break;
        case 'HOLIDAY':
          holiday++;
          break;
      }
    }

    const distinctMemberSwipeIns = new Set(memberPunchesToday.filter((p) => p.memberId).map((p) => p.memberId)).size;

    return {
      date: day.toISOString().slice(0, 10),
      totalActiveEmployees: employees.length,
      present,
      absent,
      halfDay,
      onLeave,
      holiday,
      notYetAggregated,
      memberSwipeInsToday: memberPunchesToday.length,
      distinctMembersSwipedInToday: distinctMemberSwipeIns,
    };
  }

  /** Per-employee attendance for the Employees tab — a day-by-day list
   * for one calendar month. */
  async employeeMonthlySummary(organizationId: string, employeeId: string, year: number, month: number) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    const records = await this.prisma.attendanceDayRecord.findMany({
      where: { employeeId, date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    });
    const counts = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, ON_LEAVE: 0, HOLIDAY: 0 };
    for (const r of records) counts[r.status as keyof typeof counts]++;
    return { employeeId, employeeName: employee.name, year, month, days: records, summary: counts };
  }

  /** Monthly attendance summary per employee across the whole org/branch —
   * the dashboard reporting view the user asked for. */
  async monthlySummaryAllEmployees(organizationId: string, year: number, month: number, branchId?: string) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    const employeeWhere: any = { organizationId, status: 'ACTIVE' };
    if (branchId) employeeWhere.branchId = branchId;

    const employees = await this.prisma.employee.findMany({ where: employeeWhere, select: { id: true, name: true, branchId: true } });
    const records = await this.prisma.attendanceDayRecord.findMany({
      where: { organizationId, date: { gte: from, lt: to }, employeeId: { in: employees.map((e) => e.id) } },
    });

    const byEmployee = new Map<string, { PRESENT: number; ABSENT: number; HALF_DAY: number; ON_LEAVE: number; HOLIDAY: number }>();
    for (const emp of employees) byEmployee.set(emp.id, { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, ON_LEAVE: 0, HOLIDAY: 0 });
    for (const r of records) {
      const bucket = byEmployee.get(r.employeeId);
      if (bucket) bucket[r.status as keyof typeof bucket]++;
    }

    return employees.map((emp) => ({ employeeId: emp.id, employeeName: emp.name, branchId: emp.branchId, ...byEmployee.get(emp.id)! }));
  }

  // ---- Calendar views ----
  // The Today tab shows the whole current month as a calendar so an
  // Owner can see trends at a glance, not just a single day. Past days
  // read from the nightly-aggregated AttendanceDayRecord table; the
  // current day (which the nightly cron hasn't processed yet) is
  // computed live from raw punches so "today" isn't just blank until
  // 3am tomorrow.

  async staffDailyCalendar(organizationId: string, year: number, month: number, branchId?: string) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    const employeeWhere: any = { organizationId, status: 'ACTIVE' };
    if (branchId) employeeWhere.branchId = branchId;

    const employees = await this.prisma.employee.findMany({ where: employeeWhere, select: { id: true } });
    const employeeIds = employees.map((e) => e.id);

    const records = await this.prisma.attendanceDayRecord.findMany({
      where: { organizationId, date: { gte: from, lt: to }, employeeId: { in: employeeIds } },
    });

    type Bucket = { present: number; absent: number; halfDay: number; onLeave: number; holiday: number; final: boolean };
    const byDate = new Map<string, Bucket>();
    for (const r of records) {
      const key = r.date.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? { present: 0, absent: 0, halfDay: 0, onLeave: 0, holiday: 0, final: true };
      if (r.status === 'PRESENT') bucket.present++;
      else if (r.status === 'ABSENT') bucket.absent++;
      else if (r.status === 'HALF_DAY') bucket.halfDay++;
      else if (r.status === 'ON_LEAVE') bucket.onLeave++;
      else if (r.status === 'HOLIDAY') bucket.holiday++;
      byDate.set(key, bucket);
    }

    // "Today" hasn't been through the nightly cron yet — show a live,
    // provisional present count from raw punches instead of leaving it
    // blank. Marked final:false so the UI can label it "so far today".
    const today = startOfDay(new Date());
    if (today >= from && today < to) {
      const key = today.toISOString().slice(0, 10);
      if (!byDate.has(key)) {
        const nextDay = new Date(today.getTime() + 86_400_000);
        const punches = await this.prisma.attendancePunch.findMany({
          where: { organizationId, personType: 'EMPLOYEE', employeeId: { in: employeeIds }, punchTime: { gte: today, lt: nextDay } },
          select: { employeeId: true },
        });
        const distinct = new Set(punches.filter((p) => p.employeeId).map((p) => p.employeeId)).size;
        byDate.set(key, { present: distinct, absent: 0, halfDay: 0, onLeave: 0, holiday: 0, final: false });
      }
    }

    return Array.from(byDate.entries()).map(([date, counts]) => ({ date, ...counts }));
  }

  async memberDailyCalendar(organizationId: string, year: number, month: number, branchId?: string) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    const where: any = { organizationId, personType: 'MEMBER', memberId: { not: null }, punchTime: { gte: from, lt: to } };
    if (branchId) where.branchId = branchId;

    const punches = await this.prisma.attendancePunch.findMany({ where, select: { memberId: true, punchTime: true } });
    const byDate = new Map<string, Set<string>>();
    for (const p of punches) {
      const key = p.punchTime.toISOString().slice(0, 10);
      const set = byDate.get(key) ?? new Set<string>();
      set.add(p.memberId!);
      byDate.set(key, set);
    }
    return Array.from(byDate.entries()).map(([date, set]) => ({ date, count: set.size }));
  }

  /** Drill-down behind a calendar cell: who was present that day, with
   * their first and last punch (so "first login" / "last logout"),
   * for both staff and members — clicking a number should show names,
   * per the requirement. */
  async dayDetail(organizationId: string, dateStr: string, branchId?: string) {
    const day = startOfDay(new Date(dateStr));
    const nextDay = new Date(day.getTime() + 86_400_000);

    const empWhere: any = { organizationId, personType: 'EMPLOYEE', employeeId: { not: null }, punchTime: { gte: day, lt: nextDay } };
    const memWhere: any = { organizationId, personType: 'MEMBER', memberId: { not: null }, punchTime: { gte: day, lt: nextDay } };
    if (branchId) {
      empWhere.branchId = branchId;
      memWhere.branchId = branchId;
    }

    const [empPunches, memPunches] = await Promise.all([
      this.prisma.attendancePunch.findMany({
        where: empWhere,
        include: { employee: { select: { id: true, name: true, photoUrl: true } } },
        orderBy: { punchTime: 'asc' },
      }),
      this.prisma.attendancePunch.findMany({
        where: memWhere,
        include: { member: { select: { id: true, name: true } } },
        orderBy: { punchTime: 'asc' },
      }),
    ]);

    const empMap = new Map<string, { employeeId: string; name: string; photoUrl: string | null; firstPunchAt: Date; lastPunchAt: Date }>();
    for (const p of empPunches) {
      if (!p.employeeId) continue;
      const existing = empMap.get(p.employeeId);
      if (!existing) {
        empMap.set(p.employeeId, {
          employeeId: p.employeeId,
          name: p.employee?.name ?? '',
          photoUrl: p.employee?.photoUrl ?? null,
          firstPunchAt: p.punchTime,
          lastPunchAt: p.punchTime,
        });
      } else {
        if (p.punchTime < existing.firstPunchAt) existing.firstPunchAt = p.punchTime;
        if (p.punchTime > existing.lastPunchAt) existing.lastPunchAt = p.punchTime;
      }
    }

    const memMap = new Map<string, { memberId: string; name: string; firstPunchAt: Date; lastPunchAt: Date }>();
    for (const p of memPunches) {
      if (!p.memberId) continue;
      const existing = memMap.get(p.memberId);
      if (!existing) {
        memMap.set(p.memberId, { memberId: p.memberId, name: p.member?.name ?? '', firstPunchAt: p.punchTime, lastPunchAt: p.punchTime });
      } else {
        if (p.punchTime < existing.firstPunchAt) existing.firstPunchAt = p.punchTime;
        if (p.punchTime > existing.lastPunchAt) existing.lastPunchAt = p.punchTime;
      }
    }

    return {
      date: dateStr,
      employees: Array.from(empMap.values()),
      members: Array.from(memMap.values()),
    };
  }

  /** Absent list for one date. Deliberately refuses to answer for
   * today or a future date — an employee with no punch *yet* isn't
   * "absent", the day simply isn't over. Only once the nightly cron
   * has run for a completed day (writing an ABSENT AttendanceDayRecord)
   * does someone get counted here — i.e. we wait a full day before
   * calling it absent, per how the aggregation cron already works. */
  async absentList(organizationId: string, dateStr: string, branchId?: string) {
    const day = startOfDay(new Date(dateStr));
    const today = startOfDay(new Date());
    if (day.getTime() >= today.getTime()) {
      return { date: dateStr, finalized: false, employees: [] as { employeeId: string; name: string }[] };
    }

    const records = await this.prisma.attendanceDayRecord.findMany({
      where: { organizationId, date: day, status: 'ABSENT' },
      include: { employee: { select: { id: true, name: true, branchId: true } } },
    });
    const filtered = branchId ? records.filter((r) => r.employee?.branchId === branchId) : records;

    return {
      date: dateStr,
      finalized: true,
      employees: filtered.map((r) => ({ employeeId: r.employeeId, name: r.employee?.name ?? '' })),
    };
  }

  // ---- Holidays ----

  listHolidays(organizationId: string, year?: number) {
    const where: any = { organizationId };
    if (year) {
      where.date = { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
    }
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  createHoliday(organizationId: string, dto: CreateHolidayDto) {
    return this.prisma.holiday.create({
      data: { organizationId, date: startOfDay(new Date(dto.date)), name: dto.name },
    });
  }

  async removeHoliday(organizationId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({ where: { id, organizationId } });
    if (!holiday) {
      throw new NotFoundException('Holiday not found.');
    }
    await this.prisma.holiday.delete({ where: { id } });
    return { success: true };
  }
}
