import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateMetricEntryDto } from './dto/create-metric-entry.dto';
import { S3Service } from '../uploads/s3.service';

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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export interface MemberFilters {
  branchId?: string | null;
  status?: string;
  search?: string;
}

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

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

  async create(organizationId: string, dto: CreateMemberDto) {
    await this.assertBranchInOrg(organizationId, dto.branchId);
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
        preferredLanguage: dto.preferredLanguage ?? 'en',
        paymentMode: dto.paymentMode,
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

  findAll(organizationId: string, filters: MemberFilters) {
    return this.prisma.member.findMany({
      where: {
        organizationId,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.status ? { status: filters.status as 'ACTIVE' | 'INACTIVE' } : {}),
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' as const } },
                { phone: { contains: filters.search, mode: 'insensitive' as const } },
                { email: { contains: filters.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: MEMBER_INCLUDE,
      orderBy: [{ branchId: 'asc' }, { createdAt: 'desc' }],
    });
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

    return this.prisma.member.update({
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
        ...(dto.preferredLanguage !== undefined ? { preferredLanguage: dto.preferredLanguage } : {}),
        ...(dto.paymentMode !== undefined ? { paymentMode: dto.paymentMode } : {}),
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
}
