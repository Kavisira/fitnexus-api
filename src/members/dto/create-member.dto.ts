import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

const PT_DURATIONS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const;
export type PtDuration = (typeof PT_DURATIONS)[number];

/** Only present when the selected offer is a COUPLE offer — quick-create
 * details for the linked second member (see MembersService.create). */
export class PartnerMemberDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() phone!: string;
  @IsOptional() @IsEmail() email?: string;
}

export class CreateMemberDto {
  @IsString() branchId!: string;

  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() phone!: string;
  @IsOptional() @IsEmail() email?: string;

  // Already compressed to a small JPEG data URL client-side (see
  // members.ts) before it reaches here — MembersService uploads it to
  // S3/Supabase Storage (see S3Service.uploadDataUrl) and stores only
  // the resulting public URL on Member.photoUrl.
  @IsOptional() @IsString() photoDataUrl?: string;

  @IsOptional() @IsString() source?: string;

  @IsString() planId!: string;
  @IsOptional() @IsString() offerId?: string;
  @IsOptional() @IsString() assignedTrainerEmployeeId?: string;

  // Personal Training add-on — hasPersonalTrainer=true requires
  // assignedTrainerEmployeeId above (enforced in MembersService, not
  // here, since that's a cross-field rule) plus ptDuration and
  // ptRatePerMonth below. ptStartDate is optional — the service
  // defaults it to this member's own membership startDate when
  // omitted. See Member.hasPersonalTrainer's doc comment in
  // schema.prisma for the full picture (ptEndDate/ptTotal are always
  // computed, never sent by the client).
  @IsOptional() @IsBoolean() hasPersonalTrainer?: boolean;
  @IsOptional() @IsIn(PT_DURATIONS) ptDuration?: PtDuration;
  @IsOptional() @IsNumber() @Min(0) ptRatePerMonth?: number;
  @IsOptional() @IsDateString() ptStartDate?: string;

  @IsOptional() @IsString() preferredLanguage?: string;
  @IsOptional() @IsString() paymentMode?: string;

  // Partial-payment capture (single split — see Member.amountPaid in
  // schema.prisma). Omitted entirely means "paid in full"; the service
  // defaults amountPaid to the computed price in that case.
  // paymentFollowUpDate/notify flags only matter once amountPaid is
  // below the price — validated together in the service, since that
  // depends on the computed price, not just the DTO shape.
  @IsOptional() @IsNumber() @Min(0) amountPaid?: number;
  @IsOptional() @IsDateString() paymentFollowUpDate?: string;
  @IsOptional() @IsBoolean() notifyMemberOnPaymentDue?: boolean;
  @IsOptional() @IsBoolean() notifyGymOnPaymentDue?: boolean;

  @IsOptional() @IsBoolean() isTrial?: boolean;

  @IsDateString() startDate!: string;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';

  // Health profile — all optional (see the doc comment on the Member
  // model in schema.prisma).
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsIn(GENDERS) gender?: Gender;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsNumber() @Min(30) heightCm?: number;
  @IsOptional() @IsNumber() @Min(1) goalWeightKg?: number;

  // Initial check-in, captured in the same flow as creation (wizard
  // step 4) — purely optional. When weightKg is present, the service
  // creates the member's very first MemberMetricEntry alongside it
  // (requires heightCm above to also be set, same rule as any other
  // check-in — see MembersService.addMetricEntry).
  @IsOptional() @IsNumber() @Min(1) weightKg?: number;
  @IsOptional() @IsNumber() @Min(1) chestCm?: number;
  @IsOptional() @IsNumber() @Min(1) waistCm?: number;
  @IsOptional() @IsNumber() @Min(1) hipsCm?: number;
  @IsOptional() @IsNumber() @Min(1) armsCm?: number;
  @IsOptional() @IsNumber() @Min(1) thighCm?: number;
  @IsOptional() @IsNumber() @Min(1) calfCm?: number;
  @IsOptional() @IsNumber() @Min(1) shouldersCm?: number;
  @IsOptional() @IsString() metricPhotoDataUrl?: string;

  // Only meaningful (and required) when the offer selected is type
  // COUPLE — validated in the service, since it depends on looking up
  // the offer's type, not just the DTO shape.
  @IsOptional()
  @ValidateIf((o) => o.partnerMemberId === undefined)
  @ValidateNested()
  @Type(() => PartnerMemberDto)
  partnerNew?: PartnerMemberDto;

  // Alternative to partnerNew — link an existing member as the couple
  // partner instead of creating a new one. Mutually exclusive with
  // partnerNew (enforced in the service).
  @IsOptional() @IsString() partnerMemberId?: string;
}
