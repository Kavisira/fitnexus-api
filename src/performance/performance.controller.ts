import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PerformanceService } from './performance.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateAppraisalDto } from './dto/create-appraisal.dto';
import { RespondReviewDto } from './dto/respond-review.dto';

// Reviews/appraisals are part of employee management, so they ride on
// the existing EMPLOYEES permission rather than a new matrix screen —
// same reasoning as CSV import living on EmployeesController.
@Controller('performance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PerformanceController {
  constructor(private performanceService: PerformanceService) {}

  // ---- Reviews (admin side) ----

  @Post('reviews')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  createReview(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto) {
    return this.performanceService.createReview(user, dto);
  }

  @Get('reviews')
  @RequirePermission(Screen.EMPLOYEES, 'read')
  listReviews(@CurrentUser() user: AuthenticatedUser, @Query('employeeId') employeeId: string) {
    return this.performanceService.listReviews(user, employeeId);
  }

  // Management's reply in the sign-off conversation — see the
  // Review/ReviewStatus doc comments in schema.prisma.
  @Post('reviews/:id/reply')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  replyAsManagement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RespondReviewDto) {
    return this.performanceService.replyAsManagement(user, id, dto);
  }

  // ---- Reviews (self-service) — no @RequirePermission: every
  // logged-in employee can see and act on their own reviews, same
  // self-only pattern as leave/attendance/payroll. ----

  @Get('reviews/mine')
  myReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.performanceService.myReviews(user);
  }

  @Post('reviews/mine/:id/reply')
  replyAsEmployee(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RespondReviewDto) {
    return this.performanceService.replyAsEmployee(user, id, dto);
  }

  @Post('reviews/mine/:id/sign-off')
  signOff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.performanceService.signOff(user, id);
  }

  // ---- Appraisals ----

  @Post('appraisals')
  @RequirePermission(Screen.EMPLOYEES, 'write')
  createAppraisal(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAppraisalDto) {
    return this.performanceService.createAppraisal(user, dto);
  }

  @Get('appraisals')
  @RequirePermission(Screen.EMPLOYEES, 'read')
  listAppraisals(@CurrentUser() user: AuthenticatedUser, @Query('employeeId') employeeId: string) {
    return this.performanceService.listAppraisals(user, employeeId);
  }

  @Get('appraisals/mine')
  myAppraisals(@CurrentUser() user: AuthenticatedUser) {
    return this.performanceService.myAppraisals(user);
  }
}
