-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "planId" TEXT,
    "offerId" TEXT,
    "assignedTrainerEmployeeId" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "paymentMode" TEXT,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "partnerMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_partnerMemberId_key" ON "members"("partnerMemberId");

-- CreateIndex
CREATE INDEX "members_organizationId_branchId_idx" ON "members"("organizationId", "branchId");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_assignedTrainerEmployeeId_fkey" FOREIGN KEY ("assignedTrainerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_partnerMemberId_fkey" FOREIGN KEY ("partnerMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
