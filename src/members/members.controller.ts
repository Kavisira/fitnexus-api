import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateMetricEntryDto } from './dto/create-metric-entry.dto';

@Controller('members')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MembersController {
  constructor(private membersService: MembersService) {}

  // branchId passed by the caller is only honored for the owner
  // (chain-wide) — a staff user's own branchId always wins, same pattern
  // as EmployeesController/LeadsController.

  @Post()
  @RequirePermission(Screen.MEMBERS, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMemberDto) {
    return this.membersService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.MEMBERS, 'read')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const effectiveBranchId = user.branchId ?? branchId;
    return this.membersService.findAll(user.organizationId, { branchId: effectiveBranchId, status, search });
  }

  @Get(':id')
  @RequirePermission(Screen.MEMBERS, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.membersService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission(Screen.MEMBERS, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.membersService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.MEMBERS, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.membersService.remove(user.organizationId, id);
  }

  // Monthly weight/measurement check-ins — feeds the BMI history and
  // the progress-avatar preset on the Members screen.
  @Post(':id/metrics')
  @RequirePermission(Screen.MEMBERS, 'write')
  addMetricEntry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateMetricEntryDto) {
    return this.membersService.addMetricEntry(user.organizationId, id, dto);
  }

  @Get(':id/metrics')
  @RequirePermission(Screen.MEMBERS, 'read')
  listMetricEntries(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.membersService.listMetricEntries(user.organizationId, id);
  }
}
