import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export const EXPENSE_CATEGORIES = ['RENT', 'SALARY', 'UTILITIES', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export class CreateExpenseDto {
  @IsString()
  @MinLength(1)
  branchId!: string;

  @IsIn(EXPENSE_CATEGORIES)
  category!: ExpenseCategory;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
