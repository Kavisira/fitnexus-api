import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

export interface ExpenseFilters {
  branchId?: string;
  category?: string;
  from?: string;
  to?: string;
}

const BRANCH_SELECT = { id: true, location: true, currency: true } as const;

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  /** Confirms the branch belongs to this org before an expense can be
   * attached to it — same guard BranchesService/MembersService use
   * elsewhere so a mismatched org can't smuggle in a foreign branchId. */
  private async assertBranch(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  async create(organizationId: string, dto: CreateExpenseDto) {
    await this.assertBranch(organizationId, dto.branchId);
    return this.prisma.expense.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        category: dto.category,
        amount: dto.amount,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        note: dto.note,
      },
      include: { branch: { select: BRANCH_SELECT } },
    });
  }

  /** ownBranchId (a staff user's single assigned branch) always wins
   * over whatever branchId filter was passed in the query string — only
   * the owner (ownBranchId: null) can freely filter/see across branches.
   * Same pattern as LeadsController/BranchesController. */
  findAll(organizationId: string, ownBranchId: string | null | undefined, filters: ExpenseFilters) {
    const effectiveBranchId = ownBranchId ?? filters.branchId;
    return this.prisma.expense.findMany({
      where: {
        organizationId,
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(filters.category ? { category: filters.category as never } : {}),
        ...(filters.from || filters.to
          ? {
              expenseDate: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: { branch: { select: BRANCH_SELECT } },
      orderBy: { expenseDate: 'desc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId },
      include: { branch: { select: BRANCH_SELECT } },
    });
    if (!expense) {
      throw new NotFoundException('Expense not found.');
    }
    return expense;
  }

  async update(organizationId: string, id: string, dto: UpdateExpenseDto) {
    await this.findOne(organizationId, id);
    if (dto.branchId !== undefined) {
      await this.assertBranch(organizationId, dto.branchId);
    }
    return this.prisma.expense.update({
      where: { id },
      data: {
        branchId: dto.branchId,
        category: dto.category,
        amount: dto.amount,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        note: dto.note,
      },
      include: { branch: { select: BRANCH_SELECT } },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    // Hard delete — unlike Branch/Member, an expense has no downstream
    // records referencing it, so there's no history to preserve via a
    // soft-delete status field.
    await this.prisma.expense.delete({ where: { id } });
    return { success: true };
  }
}
