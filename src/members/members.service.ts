import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateMetricEntryDto } from './dto/create-metric-entry.dto';
import { S3Service } from '../uploads/s3.service';
import { parseCsv, rowsToObjects } from '../common/csv.util';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { PtDuration } from '@prisma/client';

// Safety cap on a single bulk-import file — protects against someone
// accidentally uploading a huge spreadsheet in one request; 1000 rows
// is far beyond a realistic one-time member-roster import.
const IMPORT_ROW_CAP = 1000;

const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const STATUSES = ['ACTIVE', 'INACTIVE'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BRANCH_SELECT = { id: true, location: true, currency: true, taxRatePercent: true };
const PLAN_SELECT = { id: true, name: true, price: true, duration: true };
const OFFER_SELECT = { id: true, name: true, type: true, percentValue: true, flatAmount: true, extraMonths: true };
const TRAINER_SELECT = { id: true, name: true };

const MEMBER_INCLUDE = {
  branch: { select: BRANCH_SELECT },
  plan: { select: PLAN_SELECT },
  offer: { select: OFFER_SELECT },
  assignedTrainerEmployee: { select: TRAINER_SELECT },
  // Only the most recent check-in — enough to show current BMI/avatar
  // on the card without pulling the whole history on every list call
  // (see listMetricEntries for the full history).
  metricEntries: { orderBy: { recordedAt: 'desc' as const }, take: 1 },
};

/** Standard WHO adult BMI bands. Snapshotted onto each metric entry at
 * creation time rather than recomputed on read, so the bands changing
 * later (or a height correction) never rewrites past history. */
function bmiStatus(bmi: number): string {
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}

function computeBmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

/** Plan duration → months to add to startDate for endDate. CLASS_PACK and
 * DROP_IN aren't calendar-duration plans (usage/single-visit based), so
 * they contribute 0 — endDate defaults to startDate unless an
 * EXTRA_DURATION offer adds months on top. */
function durationMonths(duration: string): number {
  switch (duration) {
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 3;
    case 'ANNUAL':
      return 12;
    default:
      return 0;
  }
}

/** PT duration → months, deliberately separate from durationMonths()
 * above — see PtDuration's doc comment in schema.prisma for why. */
function ptDurationMonths(duration: string): number {
  switch (duration) {
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 3;
    case 'HALF_YEARLY':
      return 6;
    case 'YEARLY':
      return 12;
    default:
      return 0;
  }
}

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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export interface MemberFilters {
  // Multi-select filter panel sends 0+ branch ids / statuses; empty/undefined means "no filter".
  branchIds?: string[];
  statuses?: string[];
  // Personal Training filter — undefined means "no filter" (both PT
  // and non-PT members); true/false narrows to just one.
  hasPersonalTrainer?: boolean;
  search?: string;
  // 1-based page number and page size — see findAll's doc comment.
  page?: number;
  pageSize?: number;
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private billingService: BillingService,
    private whatsapp: WhatsappService,
    private config: ConfigService,
    private invoicePdfService: InvoicePdfService,
  ) {}

  /** This member's persistent invoice-download token — its own table
   * (MemberInvoiceAccess), deliberately separate from
   * FitnessService's MemberPublicAccess (the diet/workout public-page
   * token). A leaked invoice link should only ever expose that one
   * PDF, never also grant access to the member's fitness page — see
   * MemberInvoiceAccess's doc comment in schema.prisma. Created
   * lazily on first use. */
  private async getOrCreateInvoiceAccessToken(memberId: string): Promise<string> {
    const existing = await this.prisma.memberInvoiceAccess.findUnique({ where: { memberId } });
    if (existing) return existing.token;
    const token = randomBytes(24).toString('base64url');
    const created = await this.prisma.memberInvoiceAccess.create({ data: { memberId, token } });
    return created.token;
  }

  /** The invoice PDF's public, unauthenticated download link — goes
   * straight at this API (not a frontend route, unlike
   * FormsService.buildPublicUrl) since there's nothing to render,
   * just a file to hand back. See PublicMembersController. */
  private async buildInvoicePdfUrl(memberId: string): Promise<string> {
    const token = await this.getOrCreateInvoiceAccessToken(memberId);
    const base = (this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000/api').replace(/\/$/, '');
    return `${base}/public/members/${token}/invoice/pdf`;
  }

  /** Public counterpart of getInvoiceData, resolved by the member's
   * own invoice-access token instead of an authenticated org/member id
   * pair — see PublicMembersController. */
  async getInvoiceDataByToken(token: string) {
    const access = await this.prisma.memberInvoiceAccess.findUnique({ where: { token } });
    if (!access) {
      throw new NotFoundException('This link is invalid.');
    }
    const member = await this.prisma.member.findUnique({ where: { id: access.memberId } });
    if (!member) {
      throw new NotFoundException('This link is invalid.');
    }
    return this.getInvoiceData(member.organizationId, member.id);
  }

  /** Fire-and-forget invoice WhatsApp — same "fails soft" reasoning as
   * every other WhatsappService call in this app (see its class-level
   * doc comment): a delivery failure never blocks member creation,
   * it's a notification, not the source of truth. Reuses the generic
   * sendNotification template (no new Meta template approval needed)
   * rather than a dedicated invoice template. Sent to the member
   * and/or the org's own OWNER user, per the two notify flags. */
  /** Builds the invoice text from the member's actual payment ledger
   * (MemberPayment rows) rather than just the current amountPaid
   * total — so a settled invoice reads as "paid X on <date>, paid Y
   * on <date>, total paid in full" instead of only ever showing one
   * lump sum with no history. Used for both the initial-checkout
   * invoice (one row) and the balance-settlement invoice (two rows). */
  private buildInvoiceMessage(
    memberName: string,
    currencyCode: string,
    membershipPrice: number,
    ptTotal: number,
    ptDuration: string | null,
    payments: { amount: number; paidAt: Date; note: string | null }[],
    pdfUrl?: string,
  ): string {
    const fmt = (n: number) => `${currencyCode} ${n.toFixed(2)}`;
    const totalPayable = membershipPrice + ptTotal;
    const totalPaid = Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    const balance = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);

    // WhatsApp template body params are rejected by Meta (error 132018)
    // if they contain a newline/tab or 4+ consecutive spaces — this
    // has to be one single-spaced line, so payments are joined with
    // "; " instead of each getting its own line.
    const parts = payments.map((p) => {
      const date = p.paidAt.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
      return `${p.note ?? 'Payment'}: ${fmt(p.amount)} on ${date}`;
    });

    // PT is always its own clause, kept visually distinct from the
    // membership price — per product decision, never merged into one
    // undifferentiated number even though it's collected as one
    // payment (see Member.hasPersonalTrainer's doc comment).
    const ptClause = ptTotal > 0 ? ` Personal Training (${ptDurationLabel(ptDuration)}): ${fmt(ptTotal)}.` : '';

    const summary =
      balance > 0
        ? `Membership ${fmt(membershipPrice)}.${ptClause} Total ${fmt(totalPayable)}, paid ${fmt(totalPaid)}, balance due ${fmt(balance)}.`
        : `Membership ${fmt(membershipPrice)}.${ptClause} Total ${fmt(totalPayable)} paid in full. Thank you!`;

    const pdfLine = pdfUrl ? ` Download PDF: ${pdfUrl}` : '';
    return `Invoice for ${memberName} — ${parts.join('; ')}. ${summary}${pdfLine}`;
  }

  /** Fire-and-forget invoice WhatsApp — same "fails soft" reasoning as
   * every other WhatsappService call in this app (see its class-level
   * doc comment): a delivery failure never blocks the caller. Reuses
   * the generic sendNotification template (no new Meta template
   * approval needed) rather than a dedicated invoice template.
   *
   * Member-only, regardless of full or partial payment — the invoice
   * itself is never sent to the gym owner. Always sent whenever the
   * member has a phone number, regardless of
   * notifyMemberOnPaymentDue — that flag controls only the separate
   * outstanding-balance follow-up reminder
   * (NotificationsCronService.checkPaymentFollowUps), never whether
   * the invoice itself goes out. (It used to also gate this send,
   * which silently broke invoice delivery once that checkbox started
   * defaulting to unchecked — per the explicit business rule, the
   * invoice always goes to the member, full or partial payment, no
   * opt-in needed.) */
  private sendPaymentInvoiceMessage(member: { phone: string; name: string }, pdfBuffer: Buffer, filename: string): void {
    this.logger.log(`[INVOICE DEBUG] sendPaymentInvoiceMessage called, memberPhone=${member.phone}`);
    if (member.phone) {
      this.logger.log(`[INVOICE DEBUG] sending PDF invoice to member ${member.phone}`);
      void this.whatsapp.sendInvoicePdf(member.phone, member.name, pdfBuffer, filename);
    }
  }

  private async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
    return branch;
  }

  /** The plan must belong to both the org and the member's own branch —
   * a member can't be signed up to another branch's plan (no
   * cross-branch access in this first pass). */
  private async assertPlanInBranch(organizationId: string, branchId: string, planId: string) {
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: planId, organizationId, branchId } });
    if (!plan) {
      throw new NotFoundException('Plan not found for this branch.');
    }
    return plan;
  }

  private async assertOfferInOrg(organizationId: string, offerId: string) {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, organizationId } });
    if (!offer) {
      throw new NotFoundException('Offer not found.');
    }
    return offer;
  }

  /** Trainer must belong to the member's own branch — same reasoning as
   * the plan check above. */
  private async assertTrainerInBranch(organizationId: string, branchId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId, branchId } });
    if (!employee) {
      throw new NotFoundException('Trainer not found for this branch.');
    }
    return employee;
  }

  private async findExistingMember(organizationId: string, id: string) {
    const member = await this.prisma.member.findFirst({ where: { id, organizationId } });
    if (!member) {
      throw new NotFoundException('Member not found.');
    }
    return member;
  }

  /** basePrice adjusted by whichever offer applies to the payer of that
   * price — PERCENT_DISCOUNT/FLAT_DISCOUNT adjust the primary member's
   * own price; EXTRA_DURATION doesn't touch price at all; COUPLE doesn't
   * touch the primary's price either (it discounts the *secondary*
   * member created alongside — see create() below). */
  private priceForPrimary(basePrice: number, offer: { type: string; percentValue: unknown; flatAmount: unknown } | null): number {
    if (!offer) return basePrice;
    if (offer.type === 'PERCENT_DISCOUNT') {
      return Math.max(0, basePrice * (1 - Number(offer.percentValue) / 100));
    }
    if (offer.type === 'FLAT_DISCOUNT') {
      return Math.max(0, basePrice - Number(offer.flatAmount));
    }
    return basePrice;
  }

  /** Resolves the Personal Training add-on fields for create()/update()
   * — one shared place for the cross-field rules (trainer required,
   * duration+rate required, PT's own end date capped by the
   * membership's actual endDate) so both call sites validate and
   * compute identically. Returns all-null fields when PT isn't
   * enabled; `defaultPtStartDate` is used only when the caller didn't
   * send ptStartDate explicitly — the membership's own startDate at
   * creation, "today" when PT is being turned on via an edit (see
   * call sites). membershipEndDate must already reflect any
   * EXTRA_DURATION offer bonus — offers never touch PT itself (see
   * schema.prisma), but PT still can't outlast the membership's real,
   * final end date. */
  private resolvePersonalTraining(
    input: {
      hasPersonalTrainer?: boolean;
      assignedTrainerEmployeeId?: string | null;
      ptDuration?: PtDuration | null;
      ptRatePerMonth?: number | null;
      ptStartDate?: string | Date | null;
    },
    membershipEndDate: Date,
    defaultPtStartDate: Date,
  ): {
    hasPersonalTrainer: boolean;
    ptDuration: PtDuration | null;
    ptRatePerMonth: number | null;
    ptStartDate: Date | null;
    ptEndDate: Date | null;
    ptTotal: number | null;
  } {
    if (!input.hasPersonalTrainer) {
      return { hasPersonalTrainer: false, ptDuration: null, ptRatePerMonth: null, ptStartDate: null, ptEndDate: null, ptTotal: null };
    }
    if (!input.assignedTrainerEmployeeId) {
      throw new BadRequestException('Assign a trainer before enabling Personal Training.');
    }
    if (!input.ptDuration || input.ptRatePerMonth === undefined || input.ptRatePerMonth === null) {
      throw new BadRequestException('Personal Training needs a duration and a monthly rate.');
    }
    const ptStartDate = input.ptStartDate ? new Date(input.ptStartDate) : defaultPtStartDate;
    const months = ptDurationMonths(input.ptDuration);
    const ptEndDate = addMonths(ptStartDate, months);
    if (ptEndDate.getTime() > membershipEndDate.getTime()) {
      throw new BadRequestException("Personal Training's duration can't extend beyond the membership's remaining duration.");
    }
    const ptTotal = Math.round(input.ptRatePerMonth * months * 100) / 100;
    return { hasPersonalTrainer: true, ptDuration: input.ptDuration, ptRatePerMonth: input.ptRatePerMonth, ptStartDate, ptEndDate, ptTotal };
  }

  async create(organizationId: string, dto: CreateMemberDto) {
    await this.assertBranchInOrg(organizationId, dto.branchId);

    // Member count is the primary subscription axis (see
    // billing.constants.ts) — checked org-wide, not per-branch, since
    // the cap is on total members the org carries, not a per-branch
    // split. Full access while trialing (effectiveLimits).
    const limits = await this.billingService.effectiveLimits(organizationId);
    const currentMemberCount = await this.prisma.member.count({ where: { organizationId } });
    if (currentMemberCount >= limits.maxMembers) {
      throw new ForbiddenException(`Your current plan allows up to ${limits.maxMembers} members. Upgrade to add more.`);
    }

    const plan = await this.assertPlanInBranch(organizationId, dto.branchId, dto.planId);
    const offer = dto.offerId ? await this.assertOfferInOrg(organizationId, dto.offerId) : null;
    if (dto.assignedTrainerEmployeeId) {
      await this.assertTrainerInBranch(organizationId, dto.branchId, dto.assignedTrainerEmployeeId);
    }

    const isCouple = offer?.type === 'COUPLE';
    if (isCouple && !dto.partnerNew && !dto.partnerMemberId) {
      throw new BadRequestException('A couple offer needs a partner — either add a new member or select an existing one.');
    }
    if (isCouple && dto.partnerNew && dto.partnerMemberId) {
      throw new BadRequestException('Provide either a new partner or an existing member, not both.');
    }
    if (!isCouple && (dto.partnerNew || dto.partnerMemberId)) {
      throw new BadRequestException('Partner details are only used with a couple offer.');
    }

    const startDate = new Date(dto.startDate);
    const extraMonths = offer?.type === 'EXTRA_DURATION' ? offer.extraMonths ?? 0 : 0;
    const endDate = addMonths(startDate, durationMonths(plan.duration) + extraMonths);
    const basePrice = Number(plan.price);
    const price = this.priceForPrimary(basePrice, offer);

    // Personal Training — defaults ptStartDate to this same startDate
    // when the client didn't send one, so PT runs in lockstep with the
    // membership from day one by default (see resolvePersonalTraining's
    // doc comment).
    const pt = this.resolvePersonalTraining(
      {
        hasPersonalTrainer: dto.hasPersonalTrainer,
        assignedTrainerEmployeeId: dto.assignedTrainerEmployeeId,
        ptDuration: dto.ptDuration,
        ptRatePerMonth: dto.ptRatePerMonth,
        ptStartDate: dto.ptStartDate,
      },
      endDate,
      startDate,
    );
    const ptTotal = pt.ptTotal ?? 0;
    // Combined total — PT folds into the same amountPaid/balance/
    // settle-balance flow the membership itself uses (one payment),
    // but stays itemized as its own line in the invoice (see
    // buildInvoiceMessage/InvoicePdfService). `price` on the member
    // record stays membership-only, same as always.
    const totalPayable = price + ptTotal;

    // Partial-payment capture — omitted amountPaid means "paid in
    // full". Clamped into [0, totalPayable] so a typo can't record a
    // negative payment or an overpayment above what was actually
    // charged. The follow-up date/notify flags are only persisted
    // when there's an actual balance left to collect.
    const amountPaid = dto.amountPaid !== undefined ? Math.min(Math.max(0, dto.amountPaid), totalPayable) : totalPayable;
    const balance = Math.max(0, Math.round((totalPayable - amountPaid) * 100) / 100);

    const primary = await this.prisma.member.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        source: dto.source,
        planId: dto.planId,
        offerId: dto.offerId,
        assignedTrainerEmployeeId: dto.assignedTrainerEmployeeId,
        hasPersonalTrainer: pt.hasPersonalTrainer,
        ptDuration: pt.ptDuration,
        ptRatePerMonth: pt.ptRatePerMonth,
        ptStartDate: pt.ptStartDate,
        ptEndDate: pt.ptEndDate,
        ptTotal: pt.ptTotal,
        preferredLanguage: dto.preferredLanguage ?? 'en',
        paymentMode: dto.paymentMode,
        amountPaid,
        paymentFollowUpDate: balance > 0 && dto.paymentFollowUpDate ? new Date(dto.paymentFollowUpDate) : null,
        notifyMemberOnPaymentDue: dto.notifyMemberOnPaymentDue ?? true,
        notifyGymOnPaymentDue: dto.notifyGymOnPaymentDue ?? true,
        isTrial: dto.isTrial ?? false,
        startDate,
        endDate,
        price,
        status: dto.status ?? 'ACTIVE',
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        bloodGroup: dto.bloodGroup,
        heightCm: dto.heightCm,
        goalWeightKg: dto.goalWeightKg,
      },
      include: MEMBER_INCLUDE,
    });

    // Optional initial check-in, captured in the same creation flow
    // (wizard's measurements step) — only when weightKg and heightCm
    // are both present, same requirement as any other check-in (see
    // addMetricEntry).
    if (dto.weightKg && primary.heightCm) {
      const bmi = computeBmi(dto.weightKg, Number(primary.heightCm));
      const photoUrl = dto.metricPhotoDataUrl ? await this.s3.uploadDataUrl(primary.id, dto.metricPhotoDataUrl) : undefined;
      await this.prisma.memberMetricEntry.create({
        data: {
          memberId: primary.id,
          weightKg: dto.weightKg,
          chestCm: dto.chestCm,
          waistCm: dto.waistCm,
          hipsCm: dto.hipsCm,
          armsCm: dto.armsCm,
          thighCm: dto.thighCm,
          calfCm: dto.calfCm,
          shouldersCm: dto.shouldersCm,
          bmi,
          bmiStatus: bmiStatus(bmi),
          photoUrl,
        },
      });
    }

    // Invoice WhatsApp — only for an actual paying member. A trial
    // member hasn't paid anything (price is still computed/snapshotted
    // for when the trial converts, but no money has changed hands
    // yet), so there's nothing to invoice or log as a payment until
    // they come off trial and actually check out. Best-effort, never
    // blocks the response either way (see sendPaymentInvoiceMessage's
    // doc comment).
    this.logger.log(`[INVOICE DEBUG] primary.isTrial=${primary.isTrial} for member ${primary.id}`);
    if (!primary.isTrial) {
      // Genuinely best-effort, per the comment above — wrapped so a
      // failure anywhere in here (payment ledger row, the invoice
      // token/link, or the WhatsApp call itself) can never throw back
      // out of create() and fail member creation, and can never
      // silently swallow the whole invoice (including the plain-text
      // fallback) just because the PDF-link step hit a snag.
      try {
        this.logger.log(`[INVOICE DEBUG] entered invoice block for member ${primary.id}, amountPaid=${amountPaid}`);
        // The ledger row this and every future invoice for this member
        // is built from (see buildInvoiceMessage) — seeded here with
        // whatever was actually collected at checkout, full or partial.
        const payment = await this.prisma.memberPayment.create({
          data: { memberId: primary.id, amount: amountPaid, note: 'Initial payment' },
        });
        this.logger.log(`[INVOICE DEBUG] created MemberPayment row ${payment.id} amount=${payment.amount}`);
        const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId }, select: { currency: true } });
        // Still provision the token/link (cheap, and keeps it ready for
        // the day a proper URL-button template is approved) but don't
        // put it in the message body — Meta accepts a raw link inside
        // a template's free-text body param (200 "accepted") but then
        // silently never delivers the message, confirmed by testing
        // with/without the link. See buildInvoiceMessage's pdfUrl
        // param doc comment.
        const message = this.buildInvoiceMessage(
          primary.name,
          branch?.currency ?? 'INR',
          price,
          ptTotal,
          pt.ptDuration,
          [{ amount: Number(payment.amount), paidAt: payment.paidAt, note: payment.note }],
        );
        this.logger.log(
          `[INVOICE DEBUG] built message, phone=${primary.phone}, notifyMember=${dto.notifyMemberOnPaymentDue ?? true}: "${message}"`,
        );
        // Render the actual PDF in-memory (same renderer the
        // downloadable invoice endpoint uses) and send its raw bytes
        // to WhatsApp directly — not a link for Meta to fetch, since
        // that depends on our API being reachable from Meta's servers
        // and fails silently otherwise (see WhatsappService.uploadMedia).
        const pdfBuffer = await (async () => {
          try {
            const organization = await this.organizationForPdf(primary.organizationId);
            return await this.invoicePdfService.render(
              primary,
              [payment],
              organization,
            );
          } catch (err) {
            this.logger.error(`Failed to render invoice PDF for member ${primary.id}: ${(err as Error).message}`);
            return undefined;
          }
        })();
        if (pdfBuffer) {
          const filename = `Invoice-${primary.name.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`;
          this.sendPaymentInvoiceMessage(primary, pdfBuffer, filename);
        } else {
          this.logger.error(`Skipping invoice WhatsApp send for member ${primary.id} — PDF render failed`);
        }
      } catch (err) {
        this.logger.error(`Failed to record/send initial-payment invoice for member ${primary.id}: ${(err as Error).message}`);
      }
    }

    if (isCouple && offer) {
      const discountPercent = Number(offer.percentValue ?? 0);

      if (dto.partnerNew) {
        await this.prisma.member.create({
          data: {
            organizationId,
            branchId: dto.branchId,
            name: dto.partnerNew.name,
            phone: dto.partnerNew.phone,
            email: dto.partnerNew.email,
            source: dto.source,
            planId: dto.planId,
            offerId: dto.offerId,
            assignedTrainerEmployeeId: dto.assignedTrainerEmployeeId,
            preferredLanguage: dto.preferredLanguage ?? 'en',
            paymentMode: dto.paymentMode,
            isTrial: dto.isTrial ?? false,
            startDate,
            endDate,
            price: Math.max(0, basePrice * (1 - discountPercent / 100)),
            status: dto.status ?? 'ACTIVE',
            partnerMemberId: primary.id,
          },
        });
      } else if (dto.partnerMemberId) {
        const existing = await this.prisma.member.findFirst({
          where: { id: dto.partnerMemberId, organizationId },
        });
        if (!existing) {
          throw new NotFoundException('Partner member not found.');
        }
        if (existing.id === primary.id) {
          throw new BadRequestException('A member cannot be their own partner.');
        }
        if (existing.partnerMemberId) {
          throw new BadRequestException('That member is already paired with someone else.');
        }
        await this.prisma.member.update({
          where: { id: existing.id },
          data: {
            partnerMemberId: primary.id,
            price: Math.max(0, Number(existing.price) * (1 - discountPercent / 100)),
          },
        });
      }
    }

    return this.findOne(organizationId, primary.id);
  }

  /** Paginated — this used to return every member in the org in one
   * unbounded findMany, which was fine at dozens of members and a real
   * problem once a chain has thousands across branches (see the perf
   * audit). page/pageSize default to a first page of 25; the frontend
   * always sends both explicitly, but defaults are kept here too so
   * this stays safe against any other future caller. */
  async findAll(organizationId: string, filters: MemberFilters) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 500) : 25;

    const where = {
      organizationId,
      ...(filters.branchIds && filters.branchIds.length > 0 ? { branchId: { in: filters.branchIds } } : {}),
      ...(filters.statuses && filters.statuses.length > 0
        ? { status: { in: filters.statuses as ('ACTIVE' | 'INACTIVE')[] } }
        : {}),
      ...(filters.hasPersonalTrainer !== undefined ? { hasPersonalTrainer: filters.hasPersonalTrainer } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { phone: { contains: filters.search, mode: 'insensitive' as const } },
              { email: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        include: MEMBER_INCLUDE,
        orderBy: [{ branchId: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.member.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(organizationId: string, id: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, organizationId },
      include: MEMBER_INCLUDE,
    });
    if (!member) {
      throw new NotFoundException('Member not found.');
    }
    return member;
  }

  async update(organizationId: string, id: string, dto: UpdateMemberDto) {
    const member = await this.findExistingMember(organizationId, id);

    const targetBranchId = dto.branchId ?? member.branchId;
    if (dto.branchId && dto.branchId !== member.branchId) {
      await this.assertBranchInOrg(organizationId, dto.branchId);
    }

    const planChanged = dto.planId !== undefined && dto.planId !== member.planId;
    const offerChanged = dto.offerId !== undefined && dto.offerId !== (member.offerId ?? undefined);
    const startDateChanged = dto.startDate !== undefined;
    const needsRecalc = planChanged || offerChanged || startDateChanged || (dto.branchId && dto.branchId !== member.branchId);

    let plan = null as Awaited<ReturnType<typeof this.assertPlanInBranch>> | null;
    if (needsRecalc) {
      const planId = dto.planId ?? member.planId;
      if (!planId) {
        throw new BadRequestException('A member must have a plan.');
      }
      plan = await this.assertPlanInBranch(organizationId, targetBranchId, planId);
    }

    const offerId = dto.offerId !== undefined ? dto.offerId : member.offerId;
    const offer = needsRecalc && offerId ? await this.assertOfferInOrg(organizationId, offerId) : null;

    if (dto.assignedTrainerEmployeeId) {
      await this.assertTrainerInBranch(organizationId, targetBranchId, dto.assignedTrainerEmployeeId);
    }

    let startDate = member.startDate;
    let endDate = member.endDate;
    let price = Number(member.price);

    if (needsRecalc && plan) {
      startDate = dto.startDate ? new Date(dto.startDate) : member.startDate;
      const extraMonths = offer?.type === 'EXTRA_DURATION' ? offer.extraMonths ?? 0 : 0;
      endDate = addMonths(startDate, durationMonths(plan.duration) + extraMonths);
      // A COUPLE offer never changes on edit in this first pass (pairing
      // only happens at creation) — if the offer at edit time isn't
      // COUPLE, price is recomputed the normal way.
      if (offer?.type !== 'COUPLE') {
        price = this.priceForPrimary(Number(plan.price), offer);
      }
    }

    // Personal Training — only re-resolved when the request actually
    // touches a PT field; otherwise the member's existing PT state
    // (if any) is left completely alone, same "undefined means no
    // change" rule as every other field here. Explicitly sending
    // hasPersonalTrainer: false turns PT off and clears the stored PT
    // fields — distinct from omitting it, which leaves PT untouched.
    // ptStartDate defaults to "today" (not the membership's own,
    // possibly long-past, startDate) when PT is being turned on via
    // an edit, since that's when it actually starts getting used.
    const ptTouched =
      dto.hasPersonalTrainer !== undefined ||
      dto.ptDuration !== undefined ||
      dto.ptRatePerMonth !== undefined ||
      dto.ptStartDate !== undefined;
    const pt = ptTouched
      ? this.resolvePersonalTraining(
          {
            hasPersonalTrainer: dto.hasPersonalTrainer ?? member.hasPersonalTrainer,
            assignedTrainerEmployeeId:
              dto.assignedTrainerEmployeeId !== undefined ? dto.assignedTrainerEmployeeId : member.assignedTrainerEmployeeId,
            ptDuration: dto.ptDuration ?? member.ptDuration,
            ptRatePerMonth: dto.ptRatePerMonth ?? (member.ptRatePerMonth !== null ? Number(member.ptRatePerMonth) : null),
            ptStartDate: dto.ptStartDate ?? member.ptStartDate,
          },
          endDate,
          new Date(),
        )
      : null;
    const ptTotal = pt ? pt.ptTotal ?? 0 : Number(member.ptTotal ?? 0);
    // Combined total, same reasoning as create() — PT folds into the
    // one amountPaid/balance/settle-balance flow but stays its own
    // invoice line.
    const totalPayable = price + ptTotal;

    // "Settle remaining balance" checkbox — computed against the
    // current/pre-update amountPaid and the final totalPayable
    // (post-recalc, if anything that affects price/PT changed in this
    // same edit), so it's always settling whatever is actually still
    // owed right now, not a stale number. A trial member never has a
    // tracked balance (see create()'s isTrial guard), so this is
    // always a no-op there.
    const priorPaid = member.amountPaid !== null ? Number(member.amountPaid) : totalPayable;
    const outstandingBalance = Math.max(0, Math.round((totalPayable - priorPaid) * 100) / 100);
    const settling = dto.settleBalance === true && !member.isTrial && outstandingBalance > 0;

    const updated = await this.prisma.member.update({
      where: { id },
      data: {
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.planId !== undefined ? { planId: dto.planId } : {}),
        ...(dto.offerId !== undefined ? { offerId: dto.offerId } : {}),
        ...(dto.assignedTrainerEmployeeId !== undefined ? { assignedTrainerEmployeeId: dto.assignedTrainerEmployeeId } : {}),
        ...(pt
          ? {
              hasPersonalTrainer: pt.hasPersonalTrainer,
              ptDuration: pt.ptDuration,
              ptRatePerMonth: pt.ptRatePerMonth,
              ptStartDate: pt.ptStartDate,
              ptEndDate: pt.ptEndDate,
              ptTotal: pt.ptTotal,
            }
          : {}),
        ...(dto.preferredLanguage !== undefined ? { preferredLanguage: dto.preferredLanguage } : {}),
        ...(dto.paymentMode !== undefined ? { paymentMode: dto.paymentMode } : {}),
        // `settling` always wins over whatever dto.amountPaid/
        // paymentFollowUpDate were sent — the checkbox means "clear
        // the whole balance right now", not "set amountPaid to this
        // other number". Otherwise, clamped to [0, totalPayable] same
        // as create(); clearing the balance that way (amountPaid >=
        // totalPayable) also clears the follow-up date, since there's
        // nothing left to chase.
        ...(settling
          ? { amountPaid: totalPayable, paymentFollowUpDate: null }
          : {
              ...(dto.amountPaid !== undefined ? { amountPaid: Math.min(Math.max(0, dto.amountPaid), totalPayable) } : {}),
              ...(dto.amountPaid !== undefined && dto.amountPaid >= totalPayable ? { paymentFollowUpDate: null } : {}),
              ...(dto.paymentFollowUpDate !== undefined
                ? { paymentFollowUpDate: dto.paymentFollowUpDate ? new Date(dto.paymentFollowUpDate) : null }
                : {}),
            }),
        ...(dto.notifyMemberOnPaymentDue !== undefined ? { notifyMemberOnPaymentDue: dto.notifyMemberOnPaymentDue } : {}),
        ...(dto.notifyGymOnPaymentDue !== undefined ? { notifyGymOnPaymentDue: dto.notifyGymOnPaymentDue } : {}),
        ...(dto.isTrial !== undefined ? { isTrial: dto.isTrial } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.dateOfBirth !== undefined ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.bloodGroup !== undefined ? { bloodGroup: dto.bloodGroup } : {}),
        ...(dto.heightCm !== undefined ? { heightCm: dto.heightCm } : {}),
        ...(dto.goalWeightKg !== undefined ? { goalWeightKg: dto.goalWeightKg } : {}),
        ...(needsRecalc ? { startDate, endDate, price } : {}),
      },
      include: MEMBER_INCLUDE,
    });

    // Optional check-in, same as create()'s matching block — lets the
    // edit wizard's Measurements step record a new MemberMetricEntry
    // for an existing member too, not just at creation time. Uses
    // updated.heightCm (the post-update value) rather than the
    // pre-update member's, so a heightCm change sent in this same
    // request is honored immediately instead of needing a second save.
    if (dto.weightKg && updated.heightCm) {
      const bmi = computeBmi(dto.weightKg, Number(updated.heightCm));
      const photoUrl = dto.metricPhotoDataUrl ? await this.s3.uploadDataUrl(id, dto.metricPhotoDataUrl) : undefined;
      await this.prisma.memberMetricEntry.create({
        data: {
          memberId: id,
          weightKg: dto.weightKg,
          chestCm: dto.chestCm,
          waistCm: dto.waistCm,
          hipsCm: dto.hipsCm,
          armsCm: dto.armsCm,
          thighCm: dto.thighCm,
          calfCm: dto.calfCm,
          shouldersCm: dto.shouldersCm,
          bmi,
          bmiStatus: bmiStatus(bmi),
          photoUrl,
        },
      });
    }

    if (settling) {
      // Same "never block the actual update" reasoning as the
      // initial-payment invoice block in create() — wrapped so a
      // failure anywhere in here can't throw back out of update()
      // (the balance has already been cleared above by this point
      // regardless) and can't silently drop the whole notification
      // just because the PDF-link step failed.
      try {
        // Record the settlement itself, then rebuild the invoice from
        // the FULL ledger (initial payment + this settlement) so the
        // message reads as a complete history, not just "balance
        // cleared" with no mention of what was already paid and when.
        await this.prisma.memberPayment.create({
          data: { memberId: id, amount: outstandingBalance, note: 'Balance settled' },
        });
        const payments = await this.prisma.memberPayment.findMany({ where: { memberId: id }, orderBy: { paidAt: 'asc' } });
        const branch = await this.prisma.branch.findUnique({ where: { id: updated.branchId }, select: { currency: true } });
        // Same reasoning as the initial-payment invoice in create() —
        // provision the token but keep the link out of the message
        // body, since Meta silently drops delivery of a template
        // message whose body param contains a raw URL.
        const message = this.buildInvoiceMessage(
          updated.name,
          branch?.currency ?? 'INR',
          price,
          ptTotal,
          pt ? pt.ptDuration : updated.ptDuration,
          payments.map((p) => ({ amount: Number(p.amount), paidAt: p.paidAt, note: p.note })),
        );
        this.logger.log(
          `[INVOICE DEBUG] built settlement message, phone=${updated.phone}, notifyMember=${updated.notifyMemberOnPaymentDue}: "${message}"`,
        );
        // Same reasoning as create()'s invoice block — render the PDF
        // in-memory and send its bytes directly, no URL/fetch involved.
        const pdfBuffer = await (async () => {
          try {
            const organization = await this.organizationForPdf(updated.organizationId);
            return await this.invoicePdfService.render(updated, payments, organization);
          } catch (err) {
            this.logger.error(`Failed to render settlement invoice PDF for member ${id}: ${(err as Error).message}`);
            return undefined;
          }
        })();
        if (pdfBuffer) {
          const filename = `Invoice-${updated.name.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`;
          this.sendPaymentInvoiceMessage(updated, pdfBuffer, filename);
        } else {
          this.logger.error(`Skipping settlement invoice WhatsApp send for member ${id} — PDF render failed`);
        }
      } catch (err) {
        this.logger.error(`Failed to record/send settlement invoice for member ${id}: ${(err as Error).message}`);
      }
    }

    return updated;
  }

  /** Everything InvoicePdfService needs to render a downloadable
   * invoice — the member (with branch/plan/org context already
   * covered by MEMBER_INCLUDE) plus its full MemberPayment ledger,
   * oldest first, same ordering the WhatsApp invoice uses. Throws if
   * there's no payment recorded yet (a trial member, or one just
   * created this instant before any payment-creating code ran) —
   * there's nothing to put on an invoice in that case, so the
   * controller surfaces that as a 400 rather than handing back an
   * empty PDF. */
  async getInvoiceData(organizationId: string, memberId: string) {
    const member = await this.findExistingMember(organizationId, memberId);
    const payments = await this.prisma.memberPayment.findMany({ where: { memberId }, orderBy: { paidAt: 'asc' } });
    if (!payments.length) {
      throw new BadRequestException('No payment has been recorded for this member yet.');
    }
    const full = await this.findOne(organizationId, memberId);
    return { member: full, payments };
  }

  /** Organization name/logo for the invoice PDF header — same shape
   * PayrollService.organizationForPdf returns for payslips. */
  async organizationForPdf(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, logoUrl: true },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findExistingMember(organizationId, id);
    return this.prisma.member.delete({ where: { id } });
  }

  /** Records one monthly check-in. Requires heightCm to already be set
   * on the member (there's no way to compute a BMI without it) — the
   * caller should prompt for height first if this throws. bmi/bmiStatus
   * are computed here and frozen onto the entry; they're never derived
   * again from a later height correction, by design (see the doc
   * comment on Member.heightCm in schema.prisma). */
  async addMetricEntry(organizationId: string, memberId: string, dto: CreateMetricEntryDto) {
    const member = await this.findExistingMember(organizationId, memberId);
    if (!member.heightCm) {
      throw new BadRequestException('Set this member\'s height before logging a weight/measurement check-in.');
    }

    const bmi = computeBmi(dto.weightKg, Number(member.heightCm));

    // The client sends an already-compressed base64 data URL (see
    // members.ts) — this uploads it to S3 and swaps in the resulting
    // public URL, so the DB only ever stores a short URL string, never
    // the image bytes themselves.
    const photoUrl = dto.photoDataUrl ? await this.s3.uploadDataUrl(memberId, dto.photoDataUrl) : undefined;

    return this.prisma.memberMetricEntry.create({
      data: {
        memberId,
        weightKg: dto.weightKg,
        chestCm: dto.chestCm,
        waistCm: dto.waistCm,
        hipsCm: dto.hipsCm,
        armsCm: dto.armsCm,
        thighCm: dto.thighCm,
        calfCm: dto.calfCm,
        shouldersCm: dto.shouldersCm,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : undefined,
        bmi,
        bmiStatus: bmiStatus(bmi),
        photoUrl,
      },
    });
  }

  async listMetricEntries(organizationId: string, memberId: string) {
    await this.findExistingMember(organizationId, memberId);
    return this.prisma.memberMetricEntry.findMany({
      where: { memberId },
      orderBy: { recordedAt: 'asc' },
    });
  }

  // ---- Bulk import (CSV) ----
  // Two-step, matching the frontend's "review before saving" flow:
  // parseImportCsv() only reads and validates, nothing is written to
  // the database — the parsed rows go back to the browser for the user
  // to assign a Plan/Offer/Trainer to (in batches) before anything is
  // committed. bulkCreate() is the actual write, called once the user
  // clicks Save with every row's plan assignment attached.

  /** Reads the uploaded CSV against `branchId` and returns one entry per
   * data row with whatever validation errors it has (empty array = the
   * row is ready to have a plan assigned). Duplicate phone/email is
   * checked against this branch's existing members in one query rather
   * than per-row, so a large file doesn't fire hundreds of lookups. */
  async parseImportCsv(organizationId: string, dto: { branchId: string; csvContent: string }) {
    await this.assertBranchInOrg(organizationId, dto.branchId);

    const parsedRows = rowsToObjects(parseCsv(dto.csvContent));
    if (parsedRows.length === 0) {
      throw new BadRequestException('The CSV file has no data rows.');
    }
    if (parsedRows.length > IMPORT_ROW_CAP) {
      throw new BadRequestException(`This file has ${parsedRows.length} rows — the maximum per import is ${IMPORT_ROW_CAP}. Split it into smaller files.`);
    }

    const phones = parsedRows.map((r) => r['Phone']).filter(Boolean);
    const emails = parsedRows.map((r) => r['Email']).filter(Boolean);
    const existing = await this.prisma.member.findMany({
      where: {
        organizationId,
        branchId: dto.branchId,
        OR: [...(phones.length ? [{ phone: { in: phones } }] : []), ...(emails.length ? [{ email: { in: emails } }] : [])],
      },
      select: { phone: true, email: true },
    });
    const existingPhones = new Set(existing.map((m) => m.phone));
    const existingEmails = new Set(existing.map((m) => m.email).filter((e): e is string => !!e));

    // A file can also list the same phone/email twice against itself —
    // catch that separately from "already in the database".
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();

    return {
      rows: parsedRows.map((raw, i) => {
        const errors: string[] = [];
        const name = raw['Name'] ?? '';
        const phone = raw['Phone'] ?? '';
        const email = raw['Email'] || undefined;
        const dateOfBirth = raw['DateOfBirth'] || undefined;
        const gender = raw['Gender'] ? raw['Gender'].toUpperCase() : undefined;
        const bloodGroup = raw['BloodGroup'] || undefined;
        const heightCmRaw = raw['HeightCm'] || undefined;
        const goalWeightKgRaw = raw['GoalWeightKg'] || undefined;
        const startDate = raw['StartDate'] || undefined;
        const status = raw['Status'] ? raw['Status'].toUpperCase() : undefined;
        const source = raw['Source'] || undefined;
        const paymentMode = raw['PaymentMode'] || undefined;

        if (name.trim().length < 2) errors.push('Name is required (at least 2 characters).');
        if (!phone.trim()) errors.push('Phone is required.');
        if (email && !EMAIL_RE.test(email)) errors.push('Email is not a valid address.');
        if (dateOfBirth && !DATE_RE.test(dateOfBirth)) errors.push('DateOfBirth must be in YYYY-MM-DD format.');
        if (startDate && !DATE_RE.test(startDate)) errors.push('StartDate must be in YYYY-MM-DD format.');
        if (gender && !GENDERS.includes(gender)) errors.push('Gender must be MALE, FEMALE, or OTHER.');
        if (status && !STATUSES.includes(status)) errors.push('Status must be ACTIVE or INACTIVE.');
        if (heightCmRaw && (isNaN(Number(heightCmRaw)) || Number(heightCmRaw) < 30)) errors.push('HeightCm must be a number (at least 30).');
        if (goalWeightKgRaw && (isNaN(Number(goalWeightKgRaw)) || Number(goalWeightKgRaw) < 1)) errors.push('GoalWeightKg must be a number.');

        if (phone) {
          if (existingPhones.has(phone)) errors.push('Phone already belongs to an existing member in this branch.');
          else if (seenPhones.has(phone)) errors.push('Phone is duplicated elsewhere in this file.');
          seenPhones.add(phone);
        }
        if (email) {
          if (existingEmails.has(email)) errors.push('Email already belongs to an existing member in this branch.');
          else if (seenEmails.has(email)) errors.push('Email is duplicated elsewhere in this file.');
          seenEmails.add(email);
        }

        return {
          rowNumber: i + 2, // +1 for 1-based, +1 for the header row
          data: {
            name,
            phone,
            email,
            dateOfBirth,
            gender,
            bloodGroup,
            heightCm: heightCmRaw ? Number(heightCmRaw) : undefined,
            goalWeightKg: goalWeightKgRaw ? Number(goalWeightKgRaw) : undefined,
            startDate,
            status,
            source,
            paymentMode,
          },
          errors,
        };
      }),
    };
  }

  /** The actual write — one CreateMemberDto per row (already carrying
   * whichever plan/offer/trainer the review screen assigned), reusing
   * create() so bulk-imported members go through exactly the same
   * validation and business rules as a single manual create. Partial
   * success by design: one bad row doesn't block the rest of the file
   * from being saved. */
  async bulkCreate(organizationId: string, rows: CreateMemberDto[]) {
    if (rows.length > IMPORT_ROW_CAP) {
      throw new BadRequestException(`This request has ${rows.length} rows — the maximum per import is ${IMPORT_ROW_CAP}.`);
    }

    const results: { rowNumber: number; success: boolean; memberId?: string; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const member = await this.create(organizationId, rows[i]);
        results.push({ rowNumber: i + 2, success: true, memberId: member.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create this member.';
        results.push({ rowNumber: i + 2, success: false, error: message });
      }
    }
    return { results };
  }
}
