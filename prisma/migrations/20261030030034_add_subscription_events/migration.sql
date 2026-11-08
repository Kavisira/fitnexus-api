-- CreateEnum
CREATE TYPE "SubscriptionEventOutcome" AS ENUM ('SUCCESS', 'FAILED', 'INFO');

-- CreateEnum
CREATE TYPE "SubscriptionEventSource" AS ENUM ('WEBHOOK', 'SYNC', 'CHECKOUT');

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "outcome" "SubscriptionEventOutcome" NOT NULL,
    "source" "SubscriptionEventSource" NOT NULL,
    "tier" "SubscriptionTier",
    "billingCycle" "BillingCycle",
    "amountInr" DECIMAL(10,2),
    "description" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_events_organizationId_createdAt_idx" ON "subscription_events"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
