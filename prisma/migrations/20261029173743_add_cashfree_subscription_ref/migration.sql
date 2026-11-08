/*
  Warnings:

  - A unique constraint covering the columns `[cashfreeSubscriptionRef]` on the table `organizations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "cashfreeSubscriptionRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_cashfreeSubscriptionRef_key" ON "organizations"("cashfreeSubscriptionRef");
