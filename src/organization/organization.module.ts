import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { S3Service } from '../uploads/s3.service';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, S3Service],
})
export class OrganizationModule {}
