import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceDevicesService } from './attendance-devices.service';
import { AttendanceAggregationCronService } from './attendance-aggregation.cron';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { UpsertEnrollmentDto } from './dto/upsert-enrollment.dto';
import { CreateHolidayDto } from './dto/create-holiday.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(
    private attendanceService: AttendanceService,
    private devicesService: AttendanceDevicesService,
    private aggregationCron: AttendanceAggregationCronService,
  ) {}

  // ---- Reporting ----

  @Get('today')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  today(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return this.attendanceService.todaySnapshot(user.organizationId, branchId);
  }

  @Get('employees/:employeeId/monthly')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  employeeMonthly(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.attendanceService.employeeMonthlySummary(user.organizationId, employeeId, Number(year), Number(month));
  }

  @Get('calendar/staff')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  staffCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendanceService.staffDailyCalendar(user.organizationId, Number(year), Number(month), branchId);
  }

  @Get('calendar/members')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  memberCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendanceService.memberDailyCalendar(user.organizationId, Number(year), Number(month), branchId);
  }

  @Get('day-detail')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  dayDetail(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string, @Query('branchId') branchId?: string) {
    return this.attendanceService.dayDetail(user.organizationId, date, branchId);
  }

  @Get('absent')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  absent(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string, @Query('branchId') branchId?: string) {
    return this.attendanceService.absentList(user.organizationId, date, branchId);
  }

  @Get('monthly-summary')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  monthlySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendanceService.monthlySummaryAllEmployees(user.organizationId, Number(year), Number(month), branchId);
  }

  /** Manually re-run the nightly aggregation for a given date — useful
   * right after backfilling historical punches, or if the cron missed
   * a run, without waiting for 3am. */
  @Post('aggregate')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  aggregate(@Body('date') date: string) {
    return this.aggregationCron.aggregateDay(new Date(date));
  }

  // ---- Holidays ----

  @Get('holidays')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  listHolidays(@CurrentUser() user: AuthenticatedUser, @Query('year') year?: string) {
    return this.attendanceService.listHolidays(user.organizationId, year ? Number(year) : undefined);
  }

  @Post('holidays')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  createHoliday(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateHolidayDto) {
    return this.attendanceService.createHoliday(user.organizationId, dto);
  }

  @Delete('holidays/:id')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  removeHoliday(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.attendanceService.removeHoliday(user.organizationId, id);
  }

  // ---- Devices ----

  @Get('devices')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  listDevices(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return this.devicesService.findAll(user.organizationId, branchId);
  }

  @Post('devices')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  createDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeviceDto) {
    return this.devicesService.create(user.organizationId, dto);
  }

  @Get('devices/:id')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  getDevice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.devicesService.findOne(user.organizationId, id);
  }

  @Patch('devices/:id')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  updateDevice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devicesService.update(user.organizationId, id, dto);
  }

  @Delete('devices/:id')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  removeDevice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.devicesService.remove(user.organizationId, id);
  }

  @Post('devices/:id/rotate-key')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  rotateKey(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.devicesService.rotateApiKey(user.organizationId, id);
  }

  // ---- Enrollments ----

  @Get('devices/:deviceId/enrollments')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  listEnrollments(@CurrentUser() user: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return this.devicesService.listEnrollments(user.organizationId, deviceId);
  }

  @Post('devices/:deviceId/enrollments')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  upsertEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpsertEnrollmentDto,
  ) {
    return this.devicesService.upsertEnrollment(user.organizationId, deviceId, dto);
  }

  @Delete('devices/:deviceId/enrollments/:enrollmentId')
  @RequirePermission(Screen.ATTENDANCE, 'write')
  removeEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.devicesService.removeEnrollment(user.organizationId, deviceId, enrollmentId);
  }

  @Get('unmatched-punches')
  @RequirePermission(Screen.ATTENDANCE, 'read')
  unmatchedPunches(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.listUnmatchedPunches(user.organizationId);
  }
}
