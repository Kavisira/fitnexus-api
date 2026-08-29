import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  // ---- Admin (Owner-only, enforced in the service) ----

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.alertsService.list(user.organizationId, user.role);
  }

  @Get('assignable-targets')
  assignableTargets(@CurrentUser() user: AuthenticatedUser) {
    return this.alertsService.assignableTargets(user.organizationId, user.role);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAlertDto) {
    return this.alertsService.create(user.organizationId, user.role, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateAlertDto) {
    return this.alertsService.update(user.organizationId, user.role, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alertsService.remove(user.organizationId, user.role, id);
  }

  // ---- Any logged-in user ----

  @Get('pending')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.alertsService.pendingForUser(user.organizationId, user.userId, user.branchId);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alertsService.dismiss(user.userId, id);
  }
}
