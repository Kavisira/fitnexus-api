import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { EXPENSE_CATEGORIES, ExpenseCategory } from './create-expense.dto';

// Every field optional — this is a partial update, written out explicitly
// rather than @nestjs/mapped-types' PartialType (same call as
// UpdateBranchDto/UpdatePlanDto).
export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  branchId?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
