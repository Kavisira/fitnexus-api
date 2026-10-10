import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormsService } from './forms.service';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AuthModule, RolesModule, WhatsappModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
