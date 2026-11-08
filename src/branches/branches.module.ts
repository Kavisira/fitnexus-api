import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, RolesModule, BillingModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
