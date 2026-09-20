import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeActivityDto } from './dto/create-employee-activity.dto';
import { ParseEmployeesCsvDto, CommitEmployeesImportDto } from './dto/import-employees.dto';
import { CreateJobTitleDto } from './dto/create-job-title.dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  // branchId passed by the caller is only honored for the owner
  // (chain-wide) — a staff user's own branchId always wins, so a
  // Trainer/Manager/Front Desk can't widen their view by tampering with
  // the query param. See the same pattern in LeadsController.

  @Post()
  @RequirePermission(Screen.EMPLOYEES, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.EMPLOYEES, 'read')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const effectiveBranchId = user.branchId ?? branchId;
    return this.employeesService.findAll(user.organizationId, { branchId: effectiveBranchId, role, status, search });
  }

  // Registered before the ':id' route below — otherwise Nest would
  // match "job-titles" as an :id param instead of this literal path.
  @Get('job-titles')
  @RequirePermission(Screen.EMPLOYEES, 'read')
  listJobTitles(@CurrentUser() user: AuthenticatedUser) {
    return this.employeesService.listJobTitles(user.organizationId);
  }

  @Post('job-titles')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  createJobTitle(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateJobTitleDto) {
    return this.employeesService.ensureJobTitle(user.organizationId, dto.name);
  }

  @Get(':id')
  @RequirePermission(Screen.EMPLOYEES, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employeesService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employeesService.remove(user.organizationId, id);
  }

  @Post(':id/activities')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  addActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateEmployeeActivityDto,
  ) {
    return this.employeesService.addActivity(user.organizationId, id, dto);
  }

  // Retroactive login creation for employees added before this feature
  // existed (or created with the checkbox left unchecked) — same
  // generation logic as the checkbox, just triggered separately.
  @Post(':id/create-login')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  createLogin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employeesService.createLoginForEmployee(user.organizationId, id);
  }

  // Owner-only (enforced in the service, not just here) — the username
  // and password for this employee's login, viewable any time rather
  // than just once at creation.
  @Get(':id/credentials')
  @RequirePermission(Screen.EMPLOYEES, 'read')
  getCredentials(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employeesService.getCredentials(user.organizationId, id, user.role);
  }

  // ---- Bulk import (CSV) — see EmployeesService's doc comment. ----

  @Post('import/parse')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  parseImportCsv(@CurrentUser() user: AuthenticatedUser, @Body() dto: ParseEmployeesCsvDto) {
    return this.employeesService.parseImportCsv(user.organizationId, dto);
  }

  @Post('import/commit')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  commitImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: CommitEmployeesImportDto) {
    return this.employeesService.bulkCreate(user.organizationId, dto.rows);
  }
}
