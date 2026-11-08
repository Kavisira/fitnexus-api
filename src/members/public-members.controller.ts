import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MembersService } from './members.service';
import { InvoicePdfService } from './invoice-pdf.service';

/** Deliberately unauthenticated — same token-only model as
 * PublicFitnessController/PublicFormsController. The token is the
 * member's persistent public-access token (see
 * MembersService.getOrCreatePublicAccessToken), reused here rather
 * than minting a separate one just for invoices. This is the link
 * sent in the WhatsApp invoice message, since a WhatsApp template
 * can't carry the PDF itself as an attachment without a separate,
 * Meta-approved Document-header template. */
@Controller('public/members')
export class PublicMembersController {
  constructor(
    private membersService: MembersService,
    private invoicePdfService: InvoicePdfService,
  ) {}

  @Get(':token/invoice/pdf')
  async invoicePdf(@Param('token') token: string, @Res() res: Response) {
    const { member, payments } = await this.membersService.getInvoiceDataByToken(token);
    const organization = await this.membersService.organizationForPdf(member.organizationId);
    const buffer = await this.invoicePdfService.render(member, payments, organization);
    const filename = `Invoice-${member.name.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
