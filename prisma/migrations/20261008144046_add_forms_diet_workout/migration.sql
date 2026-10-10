-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'RATING', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'YES_NO', 'NUMBER', 'DATE');

-- CreateEnum
CREATE TYPE "WorkoutSetLoggedBy" AS ENUM ('TRAINER', 'MEMBER');

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_share_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formTemplateId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "formShareLinkId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_answers" (
    "id" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "formFieldId" TEXT NOT NULL,
    "textValue" TEXT,
    "numberValue" DECIMAL(10,2),
    "booleanValue" BOOLEAN,
    "choiceValues" TEXT[],

    CONSTRAINT "form_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "trainerEmployeeId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diet_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plan_items" (
    "id" TEXT NOT NULL,
    "dietPlanId" TEXT NOT NULL,
    "mealLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "diet_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "trainerEmployeeId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_exercises" (
    "id" TEXT NOT NULL,
    "workoutPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetSets" INTEGER NOT NULL,
    "targetReps" INTEGER NOT NULL,
    "targetWeightKg" DECIMAL(6,2),
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workout_plan_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" TEXT NOT NULL,
    "workoutPlanExerciseId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setNumber" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "weightKg" DECIMAL(6,2) NOT NULL,
    "loggedBy" "WorkoutSetLoggedBy" NOT NULL,
    "loggedByEmployeeId" TEXT,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_public_access" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_public_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_templates_organizationId_idx" ON "form_templates"("organizationId");

-- CreateIndex
CREATE INDEX "form_fields_formTemplateId_idx" ON "form_fields"("formTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "form_share_links_token_key" ON "form_share_links"("token");

-- CreateIndex
CREATE INDEX "form_share_links_organizationId_idx" ON "form_share_links"("organizationId");

-- CreateIndex
CREATE INDEX "form_share_links_memberId_idx" ON "form_share_links"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_formShareLinkId_key" ON "form_submissions"("formShareLinkId");

-- CreateIndex
CREATE INDEX "form_answers_formSubmissionId_idx" ON "form_answers"("formSubmissionId");

-- CreateIndex
CREATE INDEX "form_answers_formFieldId_idx" ON "form_answers"("formFieldId");

-- CreateIndex
CREATE INDEX "diet_plans_organizationId_idx" ON "diet_plans"("organizationId");

-- CreateIndex
CREATE INDEX "diet_plans_memberId_idx" ON "diet_plans"("memberId");

-- CreateIndex
CREATE INDEX "diet_plan_items_dietPlanId_idx" ON "diet_plan_items"("dietPlanId");

-- CreateIndex
CREATE INDEX "workout_plans_organizationId_idx" ON "workout_plans"("organizationId");

-- CreateIndex
CREATE INDEX "workout_plans_memberId_idx" ON "workout_plans"("memberId");

-- CreateIndex
CREATE INDEX "workout_plan_exercises_workoutPlanId_idx" ON "workout_plan_exercises"("workoutPlanId");

-- CreateIndex
CREATE INDEX "workout_sets_workoutPlanExerciseId_idx" ON "workout_sets"("workoutPlanExerciseId");

-- CreateIndex
CREATE INDEX "workout_sets_workoutPlanExerciseId_performedAt_idx" ON "workout_sets"("workoutPlanExerciseId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_public_access_memberId_key" ON "member_public_access"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "member_public_access_token_key" ON "member_public_access"("token");

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_share_links" ADD CONSTRAINT "form_share_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_share_links" ADD CONSTRAINT "form_share_links_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_share_links" ADD CONSTRAINT "form_share_links_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_formShareLinkId_fkey" FOREIGN KEY ("formShareLinkId") REFERENCES "form_share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_formFieldId_fkey" FOREIGN KEY ("formFieldId") REFERENCES "form_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_trainerEmployeeId_fkey" FOREIGN KEY ("trainerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_items" ADD CONSTRAINT "diet_plan_items_dietPlanId_fkey" FOREIGN KEY ("dietPlanId") REFERENCES "diet_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_trainerEmployeeId_fkey" FOREIGN KEY ("trainerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workoutPlanExerciseId_fkey" FOREIGN KEY ("workoutPlanExerciseId") REFERENCES "workout_plan_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_loggedByEmployeeId_fkey" FOREIGN KEY ("loggedByEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_public_access" ADD CONSTRAINT "member_public_access_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
