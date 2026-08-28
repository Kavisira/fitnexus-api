import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, MaxLength, Min, MinLength, ValidateIf, IsString } from 'class-validator';

const OFFER_TYPES = ['PERCENT_DISCOUNT', 'FLAT_DISCOUNT', 'EXTRA_DURATION', 'COUPLE'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/**
 * Independent, org-wide offer — not attached to any plan or branch (see
 * the doc comment on the Offer model). Only the fields relevant to
 * `type` are required — enforced here with ValidateIf rather than four
 * separate DTOs, since the shape is otherwise identical.
 */
export class CreateOfferDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;

  @IsIn(OFFER_TYPES) type!: OfferType;

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
