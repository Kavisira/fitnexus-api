import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { CreatePlatformExpenseDto, UpdatePlatformExpenseDto } from './dto/platform-expense.dto';
import { PlatformAdminJwtGuard } from './guards/platform-admin-jwt.guard';

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private platformAdminService: PlatformAdminService) {}

  // Public — this IS the login endpoint. No SubscriptionGuard impact:
  // the issued token carries no organizationId, so the global
  // SubscriptionGuard leaves it alone (see its resolveOrganizationId).
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: PlatformAdminLoginDto) {
    return this.platformAdminService.login(dto);
  }

  @UseGuards(PlatformAdminJwtGuard)
  @Get('overview')
  overview() {
    return this.platformAdminService.overview();
  }

  // Detail-list drill-down for a clickable KPI card or breakdown row.
  // segment is one of: all, signups7, signups30, trialing,
  // activePaying, churned30, or a prefixed value (status:<X>,
  // tier:<X>|UNSET, substatus:<X>) for a single breakdown-row entry.
  @UseGuards(PlatformAdminJwtGuard)
  @Get('organizations')
  organizationsBySegment(@Query('segment') segment: string) {
    return this.platformAdminService.organizationsBySegment(segment ?? 'all');
  }

  // Detail-list drill-down for the checkout funnel card. outcome is
  // one of: started, failed, converted.
  @UseGuards(PlatformAdminJwtGuard)
  @Get('checkout-events')
  checkoutEventsByOutcome(@Query('outcome') outcome: string) {
    return this.platformAdminService.checkoutEventsByOutcome(outcome ?? 'started');
  }

  @UseGuards(PlatformAdminJwtGuard)
  @Get('expenses')
  listExpenses() {
    return this.platformAdminService.listExpenses();
  }

  @UseGuards(PlatformAdminJwtGuard)
  @Post('expenses')
  createExpense(@Body() dto: CreatePlatformExpenseDto) {
    return this.platformAdminService.createExpense(dto);
  }

  @UseGuards(PlatformAdminJwtGuard)
  @Put('expenses/:id')
  updateExpense(@Param('id') id: string, @Body() dto: UpdatePlatformExpenseDto) {
    return this.platformAdminService.updateExpense(id, dto);
  }

  @UseGuards(PlatformAdminJwtGuard)
  @Delete('expenses/:id')
  deleteExpense(@Param('id') id: string) {
    return this.platformAdminService.deleteExpense(id);
  }
}
