import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationType, Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSetupDto } from './dto/update-notification-setup.dto';
import { UpdateNotificationConfigDto } from './dto/update-notification-config.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.notificationsService.list(user.organizationId, limit ? Number(limit) : undefined);
  }

  @Get('unread-group-count')
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  unreadGroupCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadGroupCount(user.organizationId);
  }

  @Patch(':id/read')
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.organizationId, id);
  }

  @Post('read-all')
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.organizationId);
  }

  @Patch(':id/close')
  @RequirePermission(Screen.NOTIFICATIONS, 'write')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.close(user.organizationId, id);
  }

  @Delete(':id')
  @RequirePermission(Screen.NOTIFICATIONS, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.remove(user.organizationId, id);
  }

  // ---- Setup (org-wide master switch) ----

  @Get('setup')
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  getSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getSetup(user.organizationId);
  }

  @Patch('setup')
  @RequirePermission(Screen.NOTIFICATIONS, 'write')
  updateSetup(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationSetupDto) {
    return this.notificationsService.updateSetup(user.organizationId, dto);
  }

  // ---- Config (per-type rules) ----

  @Get('config')
  @RequirePermission(Screen.NOTIFICATIONS, 'read')
  listConfigs(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listConfigs(user.organizationId);
  }

  @Patch('config/:type')
  @RequirePermission(Screen.NOTIFICATIONS, 'write')
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: NotificationType,
    @Body() dto: UpdateNotificationConfigDto,
  ) {
    return this.notificationsService.updateConfig(user.organizationId, type, dto);
  }
}
