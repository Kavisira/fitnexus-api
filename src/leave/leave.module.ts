import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveAllocationCronService } from './leave-allocation.cron';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AuthModule, RolesModule, WhatsappModule],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveAllocationCronService],
})
export class LeaveModule {}
