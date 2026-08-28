/*
  Warnings:

  - You are about to drop the `membership_plan_offers` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "membership_plan_offers" DROP CONSTRAINT "membership_plan_offers_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "membership_plan_offers" DROP CONSTRAINT "membership_plan_offers_planId_fkey";

-- DropTable
DROP TABLE "membership_plan_offers";

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "percentValue" DECIMAL(5,2),
    "flatAmount" DECIMAL(10,2),
    "extraMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
