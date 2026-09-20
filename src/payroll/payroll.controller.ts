import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PayrollService } from './payroll.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payslipPdfService: PayslipPdfService,
  ) {}

  // ---- Admin (Owner-only, enforced in the service — see requireOwner) ----

  @Post('generate')
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: GeneratePayrollDto) {
    return this.payrollService.generateForMonth(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.listForMonth(user, Number(year), Number(month), branchId);
  }

  // ---- Self-service: My Workspace's Payslips tab ----

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.payrollService.myPayslips(user);
  }

  @Get('me/:id')
  mineOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payrollService.myPayslip(user, id);
  }

  // ---- PDF download — self-service and admin ----

  @Get('me/:id/pdf')
  async myPayslipPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const payslip = await this.payrollService.myPayslipForPdf(user, id);
    await this.streamPdf(res, payslip, user.organizationId);
  }

  @Get(':id/pdf')
  async payslipPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const payslip = await this.payrollService.payslipForPdf(user, id);
    await this.streamPdf(res, payslip, user.organizationId);
  }

  private async streamPdf(res: Response, payslip: Awaited<ReturnType<PayrollService['myPayslipForPdf']>>, organizationId: string): Promise<void> {
    const organization = await this.payrollService.organizationForPdf(organizationId);
    const buffer = await this.payslipPdfService.render(payslip, organization);
    const filename = `Payslip-${payslip.employee.name.replace(/[^a-zA-Z0-9]+/g, '-')}-${MONTH_NAMES[payslip.month - 1]}-${payslip.year}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
