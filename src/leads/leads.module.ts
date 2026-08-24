import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [NotificationsModule, AuthModule, RolesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
