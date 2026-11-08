/*
  Warnings:

  - A unique constraint covering the columns `[cashfreeSubscriptionId]` on the table `organizations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'STARTER', 'PLUS', 'PLUS_PLUS', 'PRO', 'GROWTH', 'GROWTH_PLUS', 'SCALE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billingCycle" "BillingCycle",
ADD COLUMN     "cashfreeCustomerId" TEXT,
ADD COLUMN     "cashfreeSubscriptionId" TEXT,
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "subscriptionTier" "SubscriptionTier",
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_cashfreeSubscriptionId_key" ON "organizations"("cashfreeSubscriptionId");
