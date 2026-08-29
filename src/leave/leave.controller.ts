import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { LeaveStatus, Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { LeaveService } from './leave.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { DecideLeaveDto } from './dto/decide-leave.dto';
import { UpsertAllocationConfigDto } from './dto/upsert-allocation-config.dto';

/**
 * Self-service endpoints (my balance / apply / my requests / cancel my
 * own pending request) have no @RequirePermission — every employee can
 * always see and manage their own leave, the same way Dashboard is
 * always readable. Only the approver-facing endpoints (team requests,
 * approve/reject, allocation config) are gated by the LEAVES screen.
 */
@Controller('leave')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Get('balance')
  myBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.leaveService.myBalance(user);
  }

  @Get('requests/mine')
  myRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.leaveService.myRequests(user);
  }

  @Post('requests')
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyLeaveDto) {
    return this.leaveService.apply(user, dto);
  }

  @Delete('requests/:id')
  cancelMine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leaveService.cancelMine(user, id);
  }

  @Get('requests/team')
  @RequirePermission(Screen.LEAVES, 'read')
  teamRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: LeaveStatus,
    @Query('branchId') branchId?: string,
  ) {
    return this.leaveService.listTeamRequests(user.organizationId, user.branchId, status, branchId);
  }

  @Patch('requests/:id/approve')
  @RequirePermission(Screen.LEAVES, 'write')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leaveService.decide(user, id, true, dto);
  }

  @Patch('requests/:id/reject')
  @RequirePermission(Screen.LEAVES, 'write')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leaveService.decide(user, id, false, dto);
  }

  @Get('config')
  @RequirePermission(Screen.LEAVES, 'read')
  listConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.leaveService.listConfig(user.organizationId);
  }

  @Post('config')
  @RequirePermission(Screen.LEAVES, 'write')
  upsertConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertAllocationConfigDto) {
    return this.leaveService.upsertConfig(user.organizationId, dto);
  }
}
