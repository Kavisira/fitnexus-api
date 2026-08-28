import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Controller('plans')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PlansController {
  constructor(private plansService: PlansService) {}

  @Post()
  @RequirePermission(Screen.PLANS, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlanDto) {
    return this.plansService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.PLANS, 'read')
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    // A staff user's own branch always wins over whatever branchId was
    // passed — only the owner (branchId: null) can widen/change it, same
    // pattern as Branches/Employees/Leads.
    return this.plansService.findAll(user.organizationId, branchId, user.branchId);
  }

  @Get(':id')
  @RequirePermission(Screen.PLANS, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plansService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission(Screen.PLANS, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.PLANS, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plansService.remove(user.organizationId, id);
  }
}
