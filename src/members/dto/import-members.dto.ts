import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMemberDto } from './create-member.dto';

/** Step 1 of bulk import — parse & validate a CSV's contents against a
 * branch, before anything is written to the database (see
 * MembersService.parseImportCsv). Plan/Offer/Trainer are deliberately
 * NOT part of the CSV template — they're assigned afterward, in
 * batches, from the review screen (couple offers aren't supported in
 * bulk import at all — see the frontend's offer-picker filtering). */
export class ParseMembersCsvDto {
  @IsString() branchId!: string;
  @IsString() csvContent!: string;
}

/** Step 2 — commit the reviewed rows. Each row is a normal
 * CreateMemberDto (so it carries whatever plan/offer/trainer the review
 * screen assigned it) and is validated exactly like a single manual
 * create — this endpoint is really just "call create() once per row,
 * in one request, with a combined result report" rather than a
 * different code path. */
export class CommitMembersImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMemberDto)
  rows!: CreateMemberDto[];
}
