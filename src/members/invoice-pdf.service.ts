import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { Member, MemberPayment, Branch, Organization, MembershipPlan, Offer } from '@prisma/client';

function formatMoney(value: number): string {
  // Plain "1,234.56" grouping — currency code is printed separately in
  // the header/lines instead of a hardcoded symbol, same approach as
  // PayslipPdfService.
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Mirrors MembersService's local ptDurationLabel — duplicated rather
 * than imported since it's a one-line display mapping and this file
 * otherwise has no dependency on MembersService at all. */
function ptDurationLabel(duration: string | null | undefined): string {
  switch (duration) {
    case 'MONTHLY':
      return 'Monthly';
    case 'QUARTERLY':
      return 'Quarterly';
    case 'HALF_YEARLY':
      return 'Half-yearly';
    case 'YEARLY':
      return 'Yearly';
    default:
      return 'Personal Training';
  }
}

type MemberForInvoice = Member & {
  branch: Pick<Branch, 'location' | 'currency'>;
  plan: Pick<MembershipPlan, 'name'> | null;
  offer: Pick<Offer, 'name'> | null;
};

/**
 * Renders one member's payment ledger as a downloadable invoice PDF —
 * the document-format counterpart to the WhatsApp invoice text built
 * in MembersService.buildInvoiceMessage, both reading from the same
 * MemberPayment rows so they never disagree with each other. Built
 * with pdfkit, same pattern as PayslipPdfService (payroll module) —
 * no headless-browser dependency needed for a straightforward
 * bordered layout.
 */
@Injectable()
export class InvoicePdfService {
  async render(
    member: MemberForInvoice,
    payments: MemberPayment[],
    organization: Pick<Organization, 'name' | 'logoUrl'>,
  ): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    await this.drawHeader(doc, organization, member.branch);
    this.drawMemberInfo(doc, member);
    this.drawPaymentRows(doc, member, payments);
    this.drawFooter(doc);

    doc.end();
    return done;
  }

  private async drawHeader(
    doc: PDFKit.PDFDocument,
    organization: Pick<Organization, 'name' | 'logoUrl'>,
    branch: Pick<Branch, 'location'>,
  ): Promise<void> {
    const logoBuffer = organization.logoUrl ? await this.tryFetchLogo(organization.logoUrl) : null;
    const textLeft = logoBuffer ? 48 + 56 + 12 : 48;
    const textWidth = 500 - (textLeft - 48);

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 48, 44, { fit: [56, 56] });
      } catch {
        // A corrupt/unsupported logo shouldn't block the invoice.
      }
    }

    doc.fontSize(16).fillColor('#111827').font('Helvetica-Bold').text(organization.name, textLeft, 48, { width: textWidth });
    doc.fontSize(10).fillColor('#6b7280').font('Helvetica').text('Payment Invoice', textLeft, 70);

    doc.fontSize(9).fillColor('#6b7280').font('Helvetica').text(branch.location, textLeft, 84, { width: textWidth });

    const dividerY = Math.max(112, doc.y + 10);
    doc.moveTo(48, dividerY).lineTo(547, dividerY).strokeColor('#e5e7eb').stroke();
    doc.y = dividerY + 12;
  }

  private async tryFetchLogo(logoUrl: string): Promise<Buffer | null> {
    try {
      const response = await fetch(logoUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(new Uint8Array(arrayBuffer));
    } catch {
      return null;
    }
  }

  private drawMemberInfo(doc: PDFKit.PDFDocument, member: MemberForInvoice): void {
    const rows: [string, string][] = [
      ['Member', member.name],
      ['Phone', member.phone],
      ['Plan', member.plan?.name ?? '—'],
      ['Offer', member.offer?.name ?? '—'],
      ['Membership period', `${member.startDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })} - ${member.endDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}`],
      ['Invoice date', new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })],
    ];

    const startY = doc.y;
    doc.fontSize(9).font('Helvetica');
    rows.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 48 + col * 260;
      const y = startY + row * 18;
      doc.fillColor('#6b7280').text(`${label}:`, x, y, { continued: false, width: 90 });
      doc.fillColor('#111827').font('Helvetica-Bold').text(value, x + 90, y, { width: 160 });
      doc.font('Helvetica');
    });

    doc.y = startY + Math.ceil(rows.length / 2) * 18 + 20;
  }

  private drawPaymentRows(doc: PDFKit.PDFDocument, member: MemberForInvoice, payments: MemberPayment[]): void {
    const currency = member.branch.currency;
    const price = Number(member.price);
    const tableTop = doc.y;
    const colWidths = { date: 110, note: 250, amount: 139 };

    doc.rect(48, tableTop, 499, 22).fill('#f3f4f6');
    doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold');
    doc.text('Date', 56, tableTop + 6, { width: colWidths.date });
    doc.text('Description', 56 + colWidths.date, tableTop + 6, { width: colWidths.note });
    doc.text('Amount', 56 + colWidths.date + colWidths.note, tableTop + 6, { width: colWidths.amount - 8, align: 'right' });

    let rowY = tableTop + 22;
    doc.font('Helvetica').fontSize(9);
    let totalPaid = 0;
    for (const payment of payments) {
      const amount = Number(payment.amount);
      totalPaid += amount;
      doc.fillColor('#374151');
      doc.text(payment.paidAt.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }), 56, rowY + 4, { width: colWidths.date });
      doc.text(payment.note ?? 'Payment', 56 + colWidths.date, rowY + 4, { width: colWidths.note });
      doc.text(`${currency} ${formatMoney(amount)}`, 56 + colWidths.date + colWidths.note, rowY + 4, { width: colWidths.amount - 8, align: 'right' });
      doc.moveTo(48, rowY + 18).lineTo(547, rowY + 18).strokeColor('#f3f4f6').stroke();
      rowY += 18;
    }
    doc.rect(48, tableTop, 499, rowY - tableTop).strokeColor('#e5e7eb').stroke();

    const ptTotal = member.hasPersonalTrainer ? Number(member.ptTotal ?? 0) : 0;
    const totalPayable = price + ptTotal;
    const balance = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);
    const summaryRows: [string, number, boolean][] = [
      ['Membership price', price, false],
      // PT always printed as its own line, distinct from the
      // membership price — see Member.hasPersonalTrainer's doc
      // comment in schema.prisma — even though it's one combined
      // total/payment below.
      ...(ptTotal > 0
        ? ([[`Personal Training (${ptDurationLabel(member.ptDuration)})`, ptTotal, false]] as [string, number, boolean][])
        : []),
      ...(ptTotal > 0 ? ([['Total payable', totalPayable, false]] as [string, number, boolean][]) : []),
      ['Total paid', totalPaid, false],
      [balance > 0 ? 'Balance due' : 'Status', balance > 0 ? balance : 0, true],
    ];

    let summaryY = rowY + 16;
    for (const [label, amount, emphasize] of summaryRows) {
      if (emphasize) {
        doc.rect(48, summaryY - 2, 499, 24).fill(balance > 0 ? '#fef3c7' : '#eff6ff');
      }
      doc
        .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(emphasize ? 11 : 9.5)
        .fillColor(emphasize ? (balance > 0 ? '#b45309' : '#1d4ed8') : '#111827')
        .text(label, 56, summaryY + 3);
      if (emphasize && balance === 0) {
        doc.text('Paid in full', 400, summaryY + 3, { width: 139, align: 'right' });
      } else {
        doc.text(`${currency} ${formatMoney(amount)}`, 400, summaryY + 3, { width: 139, align: 'right' });
      }
      summaryY += emphasize ? 24 : 18;
    }
    doc.y = summaryY + 16;
  }

  private drawFooter(doc: PDFKit.PDFDocument): void {
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .font('Helvetica-Oblique')
      .text('This is a computer-generated invoice and does not require a signature.', 48, doc.y);
  }
}
