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
import { PlansModule } from './plans/plans.module';
import { OffersModule } from './offers/offers.module';
import { MembersModule } from './members/members.module';
import { ExpensesModule } from './expenses/expenses.module';
import { DashboardModule } from './dashboard/dashboard.module';

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
    PlansModule,
    OffersModule,
    MembersModule,
    ExpensesModule,
    DashboardModule,
    // Add AttendanceModule here as that page comes online (see the
    // sidenav in the Angular app — the route already exists as a
    // placeholder).
  ],
})
export class AppModule {}
