import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FitnessService } from './fitness.service';
import { UpsertDietPlanDto } from './dto/diet-plan.dto';
import { UpsertWorkoutPlanDto } from './dto/workout-plan.dto';
import { LogWorkoutSetDto, LogWorkoutSetsBulkDto } from './dto/log-workout-set.dto';

/** Authenticated (trainer/owner) side — editing plans and logging sets
 * from inside the app. The public, token-only member page lives in
 * PublicFitnessController. */
@Controller('members/:memberId/fitness')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FitnessController {
  constructor(private fitnessService: FitnessService) {}

  @Post('diet')
  @RequirePermission(Screen.FITNESS, 'write')
  upsertDiet(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string, @Body() dto: UpsertDietPlanDto) {
    return this.fitnessService.upsertDietPlan(user.organizationId, memberId, user.employeeId, dto);
  }

  @Get('diet')
  @RequirePermission(Screen.FITNESS, 'read')
  getDiet(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string) {
    return this.fitnessService.getDietPlan(user.organizationId, memberId);
  }

  @Post('workout')
  @RequirePermission(Screen.FITNESS, 'write')
  upsertWorkout(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string, @Body() dto: UpsertWorkoutPlanDto) {
    return this.fitnessService.upsertWorkoutPlan(user.organizationId, memberId, user.employeeId, dto);
  }

  @Get('workout')
  @RequirePermission(Screen.FITNESS, 'read')
  getWorkout(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string) {
    return this.fitnessService.getWorkoutPlan(user.organizationId, memberId);
  }

  @Get('workout/exercises/:exerciseId/history')
  @RequirePermission(Screen.FITNESS, 'read')
  getExerciseHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
    @Param('exerciseId') exerciseId: string,
  ) {
    return this.fitnessService.getExerciseHistory(user.organizationId, memberId, exerciseId);
  }

  @Post('workout/sets')
  @RequirePermission(Screen.FITNESS, 'write')
  logSet(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string, @Body() dto: LogWorkoutSetDto) {
    return this.fitnessService.logSetAsTrainer(user.organizationId, memberId, user.employeeId, dto);
  }

  // Bulk variant — trainer enters reps/weight once for a block of
  // identical sets. See LogWorkoutSetsBulkDto's doc comment.
  @Post('workout/sets/bulk')
  @RequirePermission(Screen.FITNESS, 'write')
  logSetsBulk(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string, @Body() dto: LogWorkoutSetsBulkDto) {
    return this.fitnessService.logSetsAsTrainer(user.organizationId, memberId, user.employeeId, dto);
  }

  @Post('public-link')
  @RequirePermission(Screen.FITNESS, 'write')
  getOrCreatePublicLink(@CurrentUser() user: AuthenticatedUser, @Param('memberId') memberId: string) {
    return this.fitnessService.getOrCreatePublicAccess(user.organizationId, memberId);
  }
}
