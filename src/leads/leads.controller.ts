import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  /** Staff (anyone but the owner) only ever sees/touches leads they
   * personally created OR that are assigned to them — see LeadsService
   * for the reasoning. The owner gets `undefined`, meaning "no
   * ownership restriction". */
  private ownScope(user: AuthenticatedUser): { userId: string; employeeId: string | null } | undefined {
    return user.role === UserRole.OWNER ? undefined : { userId: user.userId, employeeId: user.employeeId };
  }

  @Post()
  @RequirePermission(Screen.LEADS, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermission(Screen.LEADS, 'read')
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    // A staff user's own branch always wins over whatever branchId was
    // passed — only the owner (branchId: null) can widen/change it.
    const effectiveBranchId = user.branchId ?? branchId;
    return this.leadsService.findAll(user.organizationId, effectiveBranchId, this.ownScope(user));
  }

  @Get(':id')
  @RequirePermission(Screen.LEADS, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.findOne(user.organizationId, id, this.ownScope(user));
  }

  @Patch(':id')
  @RequirePermission(Screen.LEADS, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(user.organizationId, id, dto, this.ownScope(user));
  }

  @Delete(':id')
  @RequirePermission(Screen.LEADS, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.remove(user.organizationId, id, this.ownScope(user));
  }

  @Post(':id/activities')
  @RequirePermission(Screen.LEADS, 'write')
  addActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateLeadActivityDto,
  ) {
    return this.leadsService.addActivity(user.organizationId, id, dto, this.ownScope(user));
  }
}
