import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Gender } from './create-member.dto';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const PT_DURATIONS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const;
type PtDuration = (typeof PT_DURATIONS)[number];

// Couple pairing (partnerNew/partnerMemberId) only happens at creation
// time in this first pass — editing an existing member never re-pairs
// or un-pairs it.
export class UpdateMemberDto {
  @IsOptional() @IsString() branchId?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;

  @IsOptional() @IsString() photoDataUrl?: string;

  @IsOptional() @IsString() source?: string;

  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() offerId?: string;
  @IsOptional() @IsString() assignedTrainerEmployeeId?: string;

  // Personal Training add-on — same rules as CreateMemberDto's matching
  // fields. Sending hasPersonalTrainer: false explicitly turns PT off
  // (clears the stored PT fields in the service) — distinct from
  // simply omitting it, which leaves whatever PT state the member
  // already had untouched.
  @IsOptional() @IsBoolean() hasPersonalTrainer?: boolean;
  @IsOptional() @IsIn(PT_DURATIONS) ptDuration?: PtDuration;
  @IsOptional() @IsNumber() @Min(0) ptRatePerMonth?: number;
  @IsOptional() @IsDateString() ptStartDate?: string;

  @IsOptional() @IsString() preferredLanguage?: string;
  @IsOptional() @IsString() paymentMode?: string;

  // Lets an edit record a balance being cleared (or adjust the
  // follow-up/notify settings) without going through a separate
  // "record payment" endpoint — see Member.amountPaid in schema.prisma.
  @IsOptional() @IsNumber() @Min(0) amountPaid?: number;
  @IsOptional() @IsDateString() paymentFollowUpDate?: string;
  @IsOptional() @IsBoolean() notifyMemberOnPaymentDue?: boolean;
  @IsOptional() @IsBoolean() notifyGymOnPaymentDue?: boolean;

  // The "Settle remaining balance" checkbox — when true, the service
  // ignores amountPaid/paymentFollowUpDate above entirely and instead:
  // records a MemberPayment row for whatever was still owed, sets
  // amountPaid to the full price, clears paymentFollowUpDate, and
  // sends a settlement invoice (every payment row, each with its own
  // date) over WhatsApp per the member's existing notify flags. A
  // no-op (silently ignored, not an error) if there's no balance left
  // to settle — see MembersService.update.
  @IsOptional() @IsBoolean() settleBalance?: boolean;

  @IsOptional() @IsBoolean() isTrial?: boolean;

  @IsOptional() @IsDateString() startDate?: string;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsIn(GENDERS) gender?: Gender;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsNumber() @Min(30) heightCm?: number;
  @IsOptional() @IsNumber() @Min(1) goalWeightKg?: number;

  // Optional check-in, same as CreateMemberDto's matching fields —
  // lets the edit wizard's Measurements step record a new
  // MemberMetricEntry for an existing member too, not just at
  // creation time. Purely optional: when weightKg is present, the
  // service creates the check-in (requires heightCm — either already
  // on the member or sent in this same request — same rule as
  // MembersService.addMetricEntry). Omitted entirely, nothing happens.
  @IsOptional() @IsNumber() @Min(1) weightKg?: number;
  @IsOptional() @IsNumber() @Min(1) chestCm?: number;
  @IsOptional() @IsNumber() @Min(1) waistCm?: number;
  @IsOptional() @IsNumber() @Min(1) hipsCm?: number;
  @IsOptional() @IsNumber() @Min(1) armsCm?: number;
  @IsOptional() @IsNumber() @Min(1) thighCm?: number;
  @IsOptional() @IsNumber() @Min(1) calfCm?: number;
  @IsOptional() @IsNumber() @Min(1) shouldersCm?: number;
  @IsOptional() @IsString() metricPhotoDataUrl?: string;
}
