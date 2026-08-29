import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceDevicesService } from './attendance-devices.service';
import { AttendanceIngestController } from './attendance-ingest.controller';
import { AttendanceIngestService } from './attendance-ingest.service';
import { AttendanceAggregationCronService } from './attendance-aggregation.cron';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [AttendanceController, AttendanceIngestController],
  providers: [AttendanceService, AttendanceDevicesService, AttendanceIngestService, AttendanceAggregationCronService],
})
export class AttendanceModule {}
