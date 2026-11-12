import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
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
import { LeaveModule } from './leave/leave.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { PerformanceModule } from './performance/performance.module';
import { AlertsModule } from './alerts/alerts.module';
import { VersionModule } from './version/version.module';
import { OrganizationModule } from './organization/organization.module';
import { FormsModule } from './forms/forms.module';
import { FitnessModule } from './fitness/fitness.module';
import { BillingModule } from './billing/billing.module';
import { SubscriptionGuard } from './billing/guards/subscription.guard';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Enables @Cron() anywhere in the app — used by
    // NotificationsCronService for follow-up reminders and auto-clean.
    ScheduleModule.forRoot(),
    // Registered here (not just in AuthModule, which doesn't export
    // its own JwtModule) so SubscriptionGuard — a bare provider in
    // THIS module, not inside AuthModule — can inject JwtService to
    // verify bearer tokens itself. Same secret/config as AuthModule's
    // own JwtModule registration; signing stays AuthService's job,
    // this one is verify-only.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
      }),
    }),
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
    LeaveModule,
    AttendanceModule,
    PayrollModule,
    PerformanceModule,
    AlertsModule,
    OrganizationModule,
    DashboardModule,
    VersionModule,
    FormsModule,
    FitnessModule,
    BillingModule,
    PlatformAdminModule,
  ],
  providers: [
    // Applied globally so EVERY route (reads included, not just
    // writes) is blocked the instant an org's subscription has
    // expired, without having to add @UseGuards(SubscriptionGuard) to
    // every controller individually — see SubscriptionGuard's own doc
    // comment for the allowlisted paths and why it verifies the JWT
    // itself rather than depending on request.user/controller guard
    // ordering.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule {}
