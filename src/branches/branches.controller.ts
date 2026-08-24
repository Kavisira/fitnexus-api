import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BranchesController {
  constructor(private branchesService: BranchesService) {}

  @Post()
  @RequirePermission(Screen.BRANCHES, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.BRANCHES, 'read')
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.branchesService.findAll(user.organizationId, user.branchId);
  }

  @Get(':id')
  @RequirePermission(Screen.BRANCHES, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.branchesService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission(Screen.BRANCHES, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.BRANCHES, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.branchesService.remove(user.organizationId, id);
  }

  @Patch(':id/activate')
  @RequirePermission(Screen.BRANCHES, 'write')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.branchesService.activate(user.organizationId, id);
  }
}
