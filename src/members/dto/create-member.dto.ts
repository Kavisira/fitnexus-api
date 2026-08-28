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

  @IsOptional() @IsString() source?: string;

  @IsString() planId!: string;
  @IsOptional() @IsString() offerId?: string;
  @IsOptional() @IsString() assignedTrainerEmployeeId?: string;

  @IsOptional() @IsString() preferredLanguage?: string;
  @IsOptional() @IsString() paymentMode?: string;

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
