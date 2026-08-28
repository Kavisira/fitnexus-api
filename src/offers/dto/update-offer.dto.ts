import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { OfferType } from './create-offer.dto';

const OFFER_TYPES = ['PERCENT_DISCOUNT', 'FLAT_DISCOUNT', 'EXTRA_DURATION', 'COUPLE'] as const;

export class UpdateOfferDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;

  @IsOptional() @IsIn(OFFER_TYPES) type?: OfferType;

  @ValidateIf((o) => o.type === 'PERCENT_DISCOUNT' || o.type === 'COUPLE')
  @IsNumber()
  @Min(0.01)
  @Max(100)
  percentValue?: number;

  @ValidateIf((o) => o.type === 'FLAT_DISCOUNT')
  @IsNumber()
  @Min(0.01)
  flatAmount?: number;

  @ValidateIf((o) => o.type === 'EXTRA_DURATION')
  @IsInt()
  @Min(1)
  extraMonths?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
