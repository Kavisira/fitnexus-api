import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { Payslip, Employee, Branch, Organization } from '@prisma/client';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface ComponentSnapshotRow {
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  percent: number;
  amount: number;
}

type PayslipWithRelations = Payslip & {
  employee: Employee & { branch: Branch };
};

function formatMoney(value: number): string {
  // Plain "1,234.56" grouping — no currency symbol baked in here since
  // the branch's configured currency code is printed separately in the
  // header instead (same approach as the rest of the app's money
  // formatting, which is locale-driven on the frontend rather than
  // hardcoded to a symbol here).
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Renders one Payslip row (plus its employee/branch/org context) as a
 * downloadable PDF — the actual "document format" behind Payroll's
 * self-service download button. Built with pdfkit (pure JS, no
 * headless-browser dependency) since the layout is a straightforward
 * bordered table, not something that needs full HTML/CSS rendering.
 *
 * The org logo (Organization.logoUrl, uploaded once in Organization
 * Settings — see OrganizationService) is fetched and embedded in the
 * header when set; the payslip still renders fine without one.
 */
@Injectable()
export class PayslipPdfService {
  async render(payslip: PayslipWithRelations, organization: Pick<Organization, 'name' | 'logoUrl'>): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    await this.drawHeader(doc, organization);
    this.drawEmployeeInfo(doc, payslip);
    this.drawEarningsDeductions(doc, payslip);
    this.drawSummary(doc, payslip);
    this.drawFooter(doc);

    doc.end();
    return done;
  }

  private async drawHeader(doc: PDFKit.PDFDocument, organization: Pick<Organization, 'name' | 'logoUrl'>): Promise<void> {
    const logoBuffer = organization.logoUrl ? await this.tryFetchLogo(organization.logoUrl) : null;
    const textLeft = logoBuffer ? 48 + 56 + 12 : 48;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 48, 44, { fit: [56, 56] });
      } catch {
        // A corrupt/unsupported image shouldn't block the whole payslip
        // from generating — just fall back to text-only header.
      }
    }

    doc
      .fontSize(16)
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .text(organization.name, textLeft, 48, { width: 500 - (textLeft - 48) });
    doc
      .fontSize(10)
      .fillColor('#6b7280')
      .font('Helvetica')
      .text('Payslip', textLeft, 70);

    doc.moveTo(48, 112).lineTo(547, 112).strokeColor('#e5e7eb').stroke();
    doc.y = 124;
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

  private drawEmployeeInfo(doc: PDFKit.PDFDocument, payslip: PayslipWithRelations): void {
    const period = `${MONTH_NAMES[payslip.month - 1]} ${payslip.year}`;
    const rows: [string, string][] = [
      ['Employee', payslip.employee.name],
      ['Designation', payslip.employee.role],
      ['Branch', payslip.employee.branch.location],
      ['Pay period', period],
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

    doc.y = startY + Math.ceil(rows.length / 2) * 18 + 16;
  }

  private drawEarningsDeductions(doc: PDFKit.PDFDocument, payslip: PayslipWithRelations): void {
    const snapshot = (payslip.componentsSnapshot as unknown as ComponentSnapshotRow[]) ?? [];
    const earnings: [string, number][] = [['Basic', Number(payslip.basicPay)]];
    for (const c of snapshot) {
      if (c.type === 'EARNING') earnings.push([c.name, c.amount]);
    }
    const deductions: [string, number][] = [];
    for (const c of snapshot) {
      if (c.type === 'DEDUCTION') deductions.push([c.name, c.amount]);
    }
    if (Number(payslip.lopDays) > 0) {
      deductions.push([`Loss of Pay (${Number(payslip.lopDays)} day(s))`, Number(payslip.lopAmount)]);
    }

    const colWidth = 250;
    const leftX = 48;
    const rightX = 48 + colWidth + 12;
    const tableTop = doc.y;

    this.drawColumn(doc, 'Earnings', earnings, leftX, tableTop, colWidth);
    this.drawColumn(doc, 'Deductions', deductions, rightX, tableTop, colWidth);

    const rowCount = Math.max(earnings.length, deductions.length);
    doc.y = tableTop + 22 + rowCount * 16 + 20;
  }

  private drawColumn(doc: PDFKit.PDFDocument, title: string, rows: [string, number][], x: number, y: number, width: number): void {
    doc.rect(x, y, width, 22).fill('#f3f4f6');
    doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(title, x + 8, y + 6);

    let rowY = y + 22;
    doc.font('Helvetica').fontSize(9);
    for (const [label, amount] of rows) {
      doc.fillColor('#374151').text(label, x + 8, rowY + 4, { width: width - 90 });
      doc.text(formatMoney(amount), x + width - 82, rowY + 4, { width: 74, align: 'right' });
      doc.moveTo(x, rowY + 16).lineTo(x + width, rowY + 16).strokeColor('#f3f4f6').stroke();
      rowY += 16;
    }
    doc.rect(x, y, width, rowY - y).strokeColor('#e5e7eb').stroke();
  }

  private drawSummary(doc: PDFKit.PDFDocument, payslip: PayslipWithRelations): void {
    const y = doc.y;
    const rows: [string, number, boolean][] = [
      ['Gross Earnings', Number(payslip.grossEarnings), false],
      ['Total Deductions', Number(payslip.totalDeductions) + Number(payslip.lopAmount), false],
      ['Net Pay', Number(payslip.netPay), true],
    ];

    let rowY = y;
    for (const [label, amount, emphasize] of rows) {
      if (emphasize) {
        doc.rect(48, rowY - 2, 499, 24).fill('#eff6ff');
      }
      doc
        .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(emphasize ? 11 : 9.5)
        .fillColor(emphasize ? '#1d4ed8' : '#111827')
        .text(label, 56, rowY + 3);
      doc.text(formatMoney(amount), 400, rowY + 3, { width: 139, align: 'right' });
      rowY += emphasize ? 24 : 18;
    }
    doc.y = rowY + 16;
  }

  private drawFooter(doc: PDFKit.PDFDocument): void {
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .font('Helvetica-Oblique')
      .text('This is a computer-generated payslip and does not require a signature.', 48, doc.y);
  }
}
