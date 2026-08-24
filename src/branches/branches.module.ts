import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
