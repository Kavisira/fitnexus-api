import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Gender } from './create-member.dto';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

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

  @IsOptional() @IsString() preferredLanguage?: string;
  @IsOptional() @IsString() paymentMode?: string;

  @IsOptional() @IsBoolean() isTrial?: boolean;

  @IsOptional() @IsDateString() startDate?: string;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsIn(GENDERS) gender?: Gender;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsNumber() @Min(30) heightCm?: number;
  @IsOptional() @IsNumber() @Min(1) goalWeightKg?: number;
}
