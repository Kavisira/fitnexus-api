import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
