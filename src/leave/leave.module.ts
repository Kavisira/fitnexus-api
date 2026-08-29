import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveAllocationCronService } from './leave-allocation.cron';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveAllocationCronService],
})
export class LeaveModule {}
