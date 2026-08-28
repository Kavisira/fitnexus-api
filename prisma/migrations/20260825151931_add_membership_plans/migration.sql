-- CreateEnum
CREATE TYPE "PlanDuration" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'CLASS_PACK', 'DROP_IN');

-- AlterEnum
ALTER TYPE "Screen" ADD VALUE 'PLANS';

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "duration" "PlanDuration" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_branchId_name_key" ON "membership_plans"("branchId", "name");

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
