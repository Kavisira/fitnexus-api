import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateEmployeeDto } from './create-employee.dto';

/** Step 1 — parse & validate a CSV against a branch; nothing is written
 * to the database yet (see EmployeesService.parseImportCsv). Unlike
 * Members, there's no post-parse "assign in batches" step — Role and
 * BranchId are plain values the CSV can carry directly, so a row is
 * either ready to save or it isn't. createLogin is deliberately never
 * set from a bulk import (see the service doc comment). */
export class ParseEmployeesCsvDto {
  @IsString() branchId!: string;
  @IsString() csvContent!: string;
}

/** Step 2 — commit the reviewed (and possibly row-deselected) rows. */
export class CommitEmployeesImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEmployeeDto)
  rows!: CreateEmployeeDto[];
}
