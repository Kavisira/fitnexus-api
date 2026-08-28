import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ExpensesController {
  constructor(private expensesService: ExpensesService) {}

  @Post()
  @RequirePermission(Screen.EXPENSES, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.EXPENSES, 'read')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expensesService.findAll(user.organizationId, user.branchId, { branchId, category, from, to });
  }

  @Get(':id')
  @RequirePermission(Screen.EXPENSES, 'read')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expensesService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission(Screen.EXPENSES, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.EXPENSES, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expensesService.remove(user.organizationId, id);
  }
}
