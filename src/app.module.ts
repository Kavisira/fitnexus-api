import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { LeadsModule } from './leads/leads.module';
import { EmployeesModule } from './employees/employees.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Enables @Cron() anywhere in the app — used by
    // NotificationsCronService for follow-up reminders and auto-clean.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RolesModule,
    BranchesModule,
    LeadsModule,
    EmployeesModule,
    NotificationsModule,
    // Add MembersModule, AttendanceModule here as those pages come
    // online (see the sidenav in the Angular app — the routes already
    // exist as placeholders).
  ],
})
export class AppModule {}
