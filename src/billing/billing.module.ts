import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CashfreeService } from './cashfree.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, CashfreeService],
  exports: [BillingService],
})
export class BillingModule {}
