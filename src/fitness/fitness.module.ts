import { Module } from '@nestjs/common';
import { FitnessController } from './fitness.controller';
import { PublicFitnessController } from './public-fitness.controller';
import { FitnessService } from './fitness.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [FitnessController, PublicFitnessController],
  providers: [FitnessService],
  exports: [FitnessService],
})
export class FitnessModule {}
