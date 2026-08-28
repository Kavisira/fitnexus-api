-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PERCENT_DISCOUNT', 'FLAT_DISCOUNT', 'EXTRA_DURATION', 'COUPLE');

-- CreateTable
CREATE TABLE "membership_plan_offers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "percentValue" DECIMAL(5,2),
    "flatAmount" DECIMAL(10,2),
    "extraMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plan_offers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "membership_plan_offers" ADD CONSTRAINT "membership_plan_offers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plan_offers" ADD CONSTRAINT "membership_plan_offers_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
