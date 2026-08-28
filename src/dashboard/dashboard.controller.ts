import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  // Dashboard read access is hardcoded true for every role in
  // RolesService.can — this decorator is kept anyway (harmless,
  // consistent with every other route) rather than special-cased away.
  @Get('summary')
  @RequirePermission(Screen.DASHBOARD, 'read')
  summary(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    // A staff user's own branch always wins over the query param — only
    // the owner/branch-less roles can widen it. Same pattern as every
    // other module's findAll.
    const effectiveBranchId = user.branchId ?? branchId ?? null;
    return this.dashboardService.getSummary(user, effectiveBranchId);
  }
}
