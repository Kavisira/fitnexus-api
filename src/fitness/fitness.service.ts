import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { WorkoutSetLoggedBy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertDietPlanDto } from './dto/diet-plan.dto';
import { UpsertWorkoutPlanDto } from './dto/workout-plan.dto';
import { LogWorkoutSetDto, LogWorkoutSetsBulkDto } from './dto/log-workout-set.dto';

@Injectable()
export class FitnessService {
  constructor(private prisma: PrismaService) {}

  private async requireMember(organizationId: string, memberId: string) {
    const member = await this.prisma.member.findFirst({ where: { id: memberId, organizationId } });
    if (!member) {
      throw new NotFoundException('Member not found.');
    }
    return member;
  }

  // ── Diet plans (authenticated, trainer/owner side) ──────────────

  /** A member has at most one active diet plan at a time in this first
   * pass — "upsert" replaces whatever's there rather than keeping a
   * running history of past plans, matching how the product
   * discussion described it (a single current plan the trainer edits,
   * not a plan-per-version log like WorkoutSet's history). */
  async upsertDietPlan(organizationId: string, memberId: string, trainerEmployeeId: string | null, dto: UpsertDietPlanDto) {
    await this.requireMember(organizationId, memberId);

    const existing = await this.prisma.dietPlan.findFirst({ where: { organizationId, memberId } });

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.dietPlanItem.deleteMany({ where: { dietPlanId: existing.id } });
        return tx.dietPlan.update({
          where: { id: existing.id },
          data: {
            title: dto.title,
            notes: dto.notes,
            trainerEmployeeId,
            items: { create: dto.items.map((i, index) => ({ mealLabel: i.mealLabel, description: i.description, order: i.order ?? index })) },
          },
          include: { items: { orderBy: { order: 'asc' } } },
        });
      }
      return tx.dietPlan.create({
        data: {
          organizationId,
          memberId,
          trainerEmployeeId,
          title: dto.title,
          notes: dto.notes,
          items: { create: dto.items.map((i, index) => ({ mealLabel: i.mealLabel, description: i.description, order: i.order ?? index })) },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async getDietPlan(organizationId: string, memberId: string) {
    await this.requireMember(organizationId, memberId);
    return this.prisma.dietPlan.findFirst({
      where: { organizationId, memberId },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  // ── Workout plans (authenticated, trainer/owner side) ───────────

  /** Same "one current plan, replace on edit" model as diet — see
   * upsertDietPlan's comment. Deleting and recreating
   * WorkoutPlanExercise rows on every edit is safe for the plan's
   * *targets*; the actual performance history lives in WorkoutSet,
   * which is never touched here (sets reference the exercise they were
   * logged against at the time — see the FK's onDelete: Cascade,
   * which is an accepted tradeoff: editing a plan's exercise list
   * clears that exercise's logged history along with it, since the
   * exercise row itself is gone). */
  async upsertWorkoutPlan(organizationId: string, memberId: string, trainerEmployeeId: string | null, dto: UpsertWorkoutPlanDto) {
    await this.requireMember(organizationId, memberId);

    const existing = await this.prisma.workoutPlan.findFirst({ where: { organizationId, memberId } });

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.workoutPlanExercise.deleteMany({ where: { workoutPlanId: existing.id } });
        return tx.workoutPlan.update({
          where: { id: existing.id },
          data: {
            title: dto.title,
            notes: dto.notes,
            trainerEmployeeId,
            exercises: {
              create: dto.exercises.map((e, index) => ({
                name: e.name,
                muscleGroup: e.muscleGroup,
                day: e.day,
                targetSets: e.targetSets,
                targetReps: e.targetReps,
                targetWeightKg: e.targetWeightKg,
                order: e.order ?? index,
              })),
            },
          },
          include: { exercises: { orderBy: { order: 'asc' } } },
        });
      }
      return tx.workoutPlan.create({
        data: {
          organizationId,
          memberId,
          trainerEmployeeId,
          title: dto.title,
          notes: dto.notes,
          exercises: {
            create: dto.exercises.map((e, index) => ({
              name: e.name,
              muscleGroup: e.muscleGroup,
              day: e.day,
              targetSets: e.targetSets,
              targetReps: e.targetReps,
              targetWeightKg: e.targetWeightKg,
              order: e.order ?? index,
            })),
          },
        },
        include: { exercises: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async getWorkoutPlan(organizationId: string, memberId: string) {
    await this.requireMember(organizationId, memberId);
    const plan = await this.prisma.workoutPlan.findFirst({
      where: { organizationId, memberId },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });
    if (!plan) return null;
    return this.attachLastBestWeight(plan);
  }

  /** "Last best weight" per exercise — the heaviest weightKg ever
   * logged against it, across both trainer- and member-logged sets
   * (see WorkoutSet's doc comment on why both are kept distinct —
   * "best" still considers both sources, same number either way, just
   * attributed to whichever row actually holds the record). Also
   * returns the reps logged alongside that heaviest set (not an
   * independent "most reps ever" figure) — the trainer dialog shows
   * this as a single read-only "Best: N reps @ M kg" stat instead of
   * the full per-set log history. */
  private async attachLastBestWeight<T extends { exercises: { id: string }[] }>(plan: T) {
    const exerciseIds = plan.exercises.map((e) => e.id);
    if (!exerciseIds.length) {
      return { ...plan, exercises: plan.exercises.map((e) => ({ ...e, lastBestWeightKg: null, lastBestReps: null })) };
    }

    const bests = await this.prisma.workoutSet.groupBy({
      by: ['workoutPlanExerciseId'],
      where: { workoutPlanExerciseId: { in: exerciseIds } },
      _max: { weightKg: true },
    });
    const bestWeightByExercise = new Map(bests.map((b) => [b.workoutPlanExerciseId, b._max.weightKg]));

    // One extra lookup per exercise that actually has a best weight,
    // to find the reps that went with it (ties broken by most recent).
    const bestSets = await Promise.all(
      bests
        .filter((b) => b._max.weightKg != null)
        .map((b) =>
          this.prisma.workoutSet.findFirst({
            where: { workoutPlanExerciseId: b.workoutPlanExerciseId, weightKg: b._max.weightKg! },
            orderBy: { performedAt: 'desc' },
          }),
        ),
    );
    const bestRepsByExercise = new Map(bestSets.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.workoutPlanExerciseId, s.reps]));

    return {
      ...plan,
      exercises: plan.exercises.map((e) => ({
        ...e,
        lastBestWeightKg: bestWeightByExercise.get(e.id) ?? null,
        lastBestReps: bestRepsByExercise.get(e.id) ?? null,
      })),
    };
  }

  async getExerciseHistory(organizationId: string, memberId: string, exerciseId: string) {
    await this.requireMember(organizationId, memberId);
    const exercise = await this.prisma.workoutPlanExercise.findFirst({
      where: { id: exerciseId, workoutPlan: { organizationId, memberId } },
    });
    if (!exercise) {
      throw new NotFoundException('Exercise not found.');
    }
    return this.prisma.workoutSet.findMany({
      where: { workoutPlanExerciseId: exerciseId },
      orderBy: { performedAt: 'desc' },
    });
  }

  async logSetAsTrainer(organizationId: string, memberId: string, employeeId: string | null, dto: LogWorkoutSetDto) {
    await this.requireMember(organizationId, memberId);
    const exercise = await this.prisma.workoutPlanExercise.findFirst({
      where: { id: dto.workoutPlanExerciseId, workoutPlan: { organizationId, memberId } },
    });
    if (!exercise) {
      throw new BadRequestException('This exercise does not belong to this member\'s current workout plan.');
    }
    return this.prisma.workoutSet.create({
      data: {
        workoutPlanExerciseId: dto.workoutPlanExerciseId,
        setNumber: dto.setNumber,
        reps: dto.reps,
        weightKg: dto.weightKg,
        performedAt: dto.performedAt ? new Date(dto.performedAt) : undefined,
        loggedBy: WorkoutSetLoggedBy.TRAINER,
        loggedByEmployeeId: employeeId,
      },
    });
  }

  /** Bulk variant of logSetAsTrainer — see LogWorkoutSetsBulkDto's doc
   * comment. Fans out into `dto.sets` individual WorkoutSet rows (same
   * reps/weight/performedAt, incrementing setNumber) inside one
   * transaction, so a half-written block can never happen. Returns
   * the created rows — the UI collapses them back into one summary
   * line, but the underlying history stays one row per set. */
  async logSetsAsTrainer(organizationId: string, memberId: string, employeeId: string | null, dto: LogWorkoutSetsBulkDto) {
    await this.requireMember(organizationId, memberId);
    const exercise = await this.prisma.workoutPlanExercise.findFirst({
      where: { id: dto.workoutPlanExerciseId, workoutPlan: { organizationId, memberId } },
    });
    if (!exercise) {
      throw new BadRequestException('This exercise does not belong to this member\'s current workout plan.');
    }
    const performedAt = dto.performedAt ? new Date(dto.performedAt) : new Date();
    return this.prisma.$transaction(
      Array.from({ length: dto.sets }, (_, i) =>
        this.prisma.workoutSet.create({
          data: {
            workoutPlanExerciseId: dto.workoutPlanExerciseId,
            setNumber: i + 1,
            reps: dto.reps,
            weightKg: dto.weightKg,
            performedAt,
            loggedBy: WorkoutSetLoggedBy.TRAINER,
            loggedByEmployeeId: employeeId,
          },
        }),
      ),
    );
  }

  // ── Public (unauthenticated) member page ────────────────────────

  /** Lazily creates the member's one persistent public-access token
   * the first time it's needed (e.g. a trainer clicks "Share" for the
   * first time) — see MemberPublicAccess's doc comment for why this is
   * a separate, non-single-use token from FormShareLink's. */
  async getOrCreatePublicAccess(organizationId: string, memberId: string) {
    await this.requireMember(organizationId, memberId);
    const existing = await this.prisma.memberPublicAccess.findUnique({ where: { memberId } });
    if (existing) return existing;
    const token = randomBytes(24).toString('base64url');
    return this.prisma.memberPublicAccess.create({ data: { memberId, token } });
  }

  private async requirePublicMember(token: string) {
    const access = await this.prisma.memberPublicAccess.findUnique({
      where: { token },
      include: { member: { select: { id: true, name: true, gender: true, organizationId: true } } },
    });
    if (!access) {
      throw new NotFoundException('This link is invalid.');
    }
    return access.member;
  }

  /** `gender` here drives which half of a 4-panel exercise-sprite
   * image (Male-Start/Male-End/Female-Start/Female-End) the public
   * page shows — see ExerciseSprite on the frontend. Not sensitive
   * data: it's the same field the trainer-facing app already shows
   * freely, just surfaced on this one read-only public page too. */
  async getPublicPlans(token: string) {
    const member = await this.requirePublicMember(token);
    const [diet, workout] = await Promise.all([
      this.prisma.dietPlan.findFirst({ where: { memberId: member.id }, include: { items: { orderBy: { order: 'asc' } } } }),
      this.prisma.workoutPlan.findFirst({ where: { memberId: member.id }, include: { exercises: { orderBy: { order: 'asc' } } } }),
    ]);
    return {
      memberName: member.name,
      memberGender: member.gender,
      diet,
      workout: workout ? await this.attachLastBestWeight(workout) : null,
    };
  }

  /** Member self-logging a completed set, via the public token-only
   * page. Deliberately append-only and MEMBER-tagged — see
   * WorkoutSet's doc comment. No edit/delete counterpart exists for
   * this path on purpose. */
  async logSetAsMember(token: string, dto: LogWorkoutSetDto) {
    const member = await this.requirePublicMember(token);
    const exercise = await this.prisma.workoutPlanExercise.findFirst({
      where: { id: dto.workoutPlanExerciseId, workoutPlan: { memberId: member.id } },
    });
    if (!exercise) {
      throw new BadRequestException('This exercise does not belong to your current workout plan.');
    }
    return this.prisma.workoutSet.create({
      data: {
        workoutPlanExerciseId: dto.workoutPlanExerciseId,
        setNumber: dto.setNumber,
        reps: dto.reps,
        weightKg: dto.weightKg,
        loggedBy: WorkoutSetLoggedBy.MEMBER,
      },
    });
  }

  /** Bulk variant for the member's own self-logging — same convenience
   * as logSetsAsTrainer (enter reps/weight once for a block of
   * identical sets instead of one at a time), still append-only and
   * MEMBER-tagged. Always uses "now" — no back-dating from the public
   * page, same as the single-set path above. */
  async logSetsAsMember(token: string, dto: LogWorkoutSetsBulkDto) {
    const member = await this.requirePublicMember(token);
    const exercise = await this.prisma.workoutPlanExercise.findFirst({
      where: { id: dto.workoutPlanExerciseId, workoutPlan: { memberId: member.id } },
    });
    if (!exercise) {
      throw new BadRequestException('This exercise does not belong to your current workout plan.');
    }
    const performedAt = new Date();
    return this.prisma.$transaction(
      Array.from({ length: dto.sets }, (_, i) =>
        this.prisma.workoutSet.create({
          data: {
            workoutPlanExerciseId: dto.workoutPlanExerciseId,
            setNumber: i + 1,
            reps: dto.reps,
            weightKg: dto.weightKg,
            performedAt,
            loggedBy: WorkoutSetLoggedBy.MEMBER,
          },
        }),
      ),
    );
  }
}
