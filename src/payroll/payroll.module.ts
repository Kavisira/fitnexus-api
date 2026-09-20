import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayslipPdfService } from './payslip-pdf.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollController],
  providers: [PayrollService, PayslipPdfService],
})
export class PayrollModule {}
