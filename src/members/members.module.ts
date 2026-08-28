import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { S3Service } from '../uploads/s3.service';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [MembersController],
  providers: [MembersService, S3Service],
})
export class MembersModule {}
