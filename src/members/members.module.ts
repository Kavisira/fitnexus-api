import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { PublicMembersController } from './public-members.controller';
import { MembersService } from './members.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { BillingModule } from '../billing/billing.module';
import { S3Service } from '../uploads/s3.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { InvoicePdfService } from './invoice-pdf.service';

@Module({
  imports: [AuthModule, RolesModule, BillingModule, WhatsappModule],
  controllers: [MembersController, PublicMembersController],
  providers: [MembersService, S3Service, InvoicePdfService],
})
export class MembersModule {}
