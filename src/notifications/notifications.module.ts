import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsCronService } from './notifications-cron.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    // AuthModule exports PermissionGuard, used here via
    // @UseGuards(PermissionGuard). RolesModule is ALSO needed directly:
    // Nest resolves an exported provider's own constructor deps (here,
    // PermissionGuard needs RolesService) against the *consuming*
    // module's container, not just the module that originally declared
    // it — so RolesService must be reachable from this module's own
    // imports too, not only via AuthModule. Same reason
    // Employees/Leads/BranchesModule import both, not just AuthModule.
    AuthModule,
    RolesModule,
    // Own JwtModule registration (same secret/env var as AuthModule)
    // since AuthModule doesn't export its own — needed here so the
    // WebSocket gateway can verify a connecting client's token by hand
    // (HTTP guards don't run against a socket handshake).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationsCronService],
  // Exported so other modules (LeadsModule now, more later) can inject
  // NotificationsService and call notify() directly.
  exports: [NotificationsService],
})
export class NotificationsModule {}
