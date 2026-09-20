import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateAppraisalDto } from './dto/create-appraisal.dto';
import { RespondReviewDto } from './dto/respond-review.dto';

const REVIEW_INCLUDE = { responses: { orderBy: { createdAt: 'asc' as const } } };

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  // ---- Reviews — see the Review/ReviewStatus doc comments in
  // schema.prisma for the full sign-off flow. Write access to CREATE a
  // review, and to reply as management, is gated by the EMPLOYEES
  // permission at the controller; replying/signing off as the employee
  // is self-service, checked here against the caller's own
  // employeeId. ----

  async createReview(user: AuthenticatedUser, dto: CreateReviewDto) {
    await this.assertEmployeeInOrg(user.organizationId, dto.employeeId);
    return this.prisma.review.create({
      data: {
        organizationId: user.organizationId,
        employeeId: dto.employeeId,
        reviewerUserId: user.userId,
        reviewDate: new Date(dto.reviewDate),
        rating: dto.rating,
        notes: dto.notes,
      },
      include: REVIEW_INCLUDE,
    });
  }

  async listReviews(user: AuthenticatedUser, employeeId: string) {
    await this.assertEmployeeInOrg(user.organizationId, employeeId);
    return this.prisma.review.findMany({ where: { employeeId }, include: REVIEW_INCLUDE, orderBy: { reviewDate: 'desc' } });
  }

  /** Self-service — My Workspace's Reviews tab. */
  async myReviews(user: AuthenticatedUser) {
    if (!user.employeeId) return [];
    return this.prisma.review.findMany({
      where: { employeeId: user.employeeId },
      include: REVIEW_INCLUDE,
      orderBy: { reviewDate: 'desc' },
    });
  }

  /** Management replies on a review — only legal while it's the
   * employee's own reply sitting in management's court (PENDING_MANAGEMENT),
   * or on a freshly created one nobody has responded to yet
   * (PENDING_EMPLOYEE, e.g. management adding a follow-up note before
   * the employee has said anything). Never legal once SIGNED_OFF. */
  async replyAsManagement(user: AuthenticatedUser, reviewId: string, dto: RespondReviewDto) {
    const review = await this.getReviewInOrg(user.organizationId, reviewId);
    if (review.status === 'SIGNED_OFF') {
      throw new BadRequestException('This review is already signed off and closed.');
    }
    await this.prisma.$transaction([
      this.prisma.reviewResponse.create({
        data: { reviewId, authorType: 'MANAGEMENT', authorUserId: user.userId, message: dto.message },
      }),
      this.prisma.review.update({ where: { id: reviewId }, data: { status: 'PENDING_EMPLOYEE' } }),
    ]);
    return this.prisma.review.findUnique({ where: { id: reviewId }, include: REVIEW_INCLUDE });
  }

  /** Employee replies with their own thoughts — puts the ball back in
   * management's court. Self-only: can only reply to their own review. */
  async replyAsEmployee(user: AuthenticatedUser, reviewId: string, dto: RespondReviewDto) {
    const review = await this.getOwnReview(user, reviewId);
    if (review.status === 'SIGNED_OFF') {
      throw new BadRequestException('This review is already signed off and closed.');
    }
    await this.prisma.$transaction([
      this.prisma.reviewResponse.create({
        data: { reviewId, authorType: 'EMPLOYEE', authorUserId: user.userId, message: dto.message },
      }),
      this.prisma.review.update({ where: { id: reviewId }, data: { status: 'PENDING_MANAGEMENT' } }),
    ]);
    return this.prisma.review.findUnique({ where: { id: reviewId }, include: REVIEW_INCLUDE });
  }

  /** Employee signs off — agreeing with the review as it currently
   * stands, closing the thread. Only the employee can do this; there's
   * no management-side "force close". */
  async signOff(user: AuthenticatedUser, reviewId: string) {
    const review = await this.getOwnReview(user, reviewId);
    if (review.status === 'SIGNED_OFF') {
      return review;
    }
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'SIGNED_OFF', signedOffAt: new Date() },
      include: REVIEW_INCLUDE,
    });
  }

  private async getReviewInOrg(organizationId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, organizationId } });
    if (!review) {
      throw new NotFoundException('Review not found.');
    }
    return review;
  }

  private async getOwnReview(user: AuthenticatedUser, reviewId: string) {
    if (!user.employeeId) {
      throw new NotFoundException('Review not found.');
    }
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, employeeId: user.employeeId } });
    if (!review) {
      throw new NotFoundException('Review not found.');
    }
    return review;
  }

  // ---- Appraisals — a pay change plus a generated letter, also
  // logged ad hoc. Updates the employee's live basicPay immediately
  // (the letter/record is the historical snapshot; the salary
  // structure editor on the Employees screen reflects the new figure
  // right away). No response/sign-off flow — a pay change is a
  // one-way notice, unlike a review. ----

  async createAppraisal(user: AuthenticatedUser, dto: CreateAppraisalDto) {
    const employee = await this.assertEmployeeInOrg(user.organizationId, dto.employeeId);
    const newBasicPay = Number(dto.newBasicPay);
    if (Number.isNaN(newBasicPay) || newBasicPay < 0) {
      throw new BadRequestException('newBasicPay must be a non-negative number.');
    }
    const previousBasicPay = employee.basicPay != null ? Number(employee.basicPay) : null;
    const effectiveDate = new Date(dto.effectiveDate);
    const letterContent = this.buildLetter(employee.name, previousBasicPay, newBasicPay, effectiveDate, dto.note);

    const [, appraisal] = await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id: employee.id }, data: { basicPay: newBasicPay } }),
      this.prisma.appraisal.create({
        data: {
          organizationId: user.organizationId,
          employeeId: employee.id,
          effectiveDate,
          previousBasicPay,
          newBasicPay,
          note: dto.note,
          letterContent,
          createdByUserId: user.userId,
        },
      }),
    ]);
    return appraisal;
  }

  async listAppraisals(user: AuthenticatedUser, employeeId: string) {
    await this.assertEmployeeInOrg(user.organizationId, employeeId);
    return this.prisma.appraisal.findMany({ where: { employeeId }, orderBy: { effectiveDate: 'desc' } });
  }

  /** Self-service — My Workspace's Appraisal Letters tab. */
  async myAppraisals(user: AuthenticatedUser) {
    if (!user.employeeId) return [];
    return this.prisma.appraisal.findMany({ where: { employeeId: user.employeeId }, orderBy: { effectiveDate: 'desc' } });
  }

  private async assertEmployeeInOrg(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    return employee;
  }

  private buildLetter(employeeName: string, previousBasicPay: number | null, newBasicPay: number, effectiveDate: Date, note?: string): string {
    const dateStr = effectiveDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const previousLine = previousBasicPay != null ? `Your previous basic pay was ${previousBasicPay.toFixed(2)}.` : '';
    const noteLine = note ? `\n\n${note}` : '';
    return [
      `Dear ${employeeName},`,
      '',
      `We are pleased to inform you of a revision to your compensation, effective ${dateStr}.`,
      '',
      `Your new basic pay is ${newBasicPay.toFixed(2)}. ${previousLine}`.trim(),
      noteLine,
      '',
      'Congratulations, and thank you for your continued contribution.',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }
}
