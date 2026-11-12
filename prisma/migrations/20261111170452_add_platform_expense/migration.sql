-- CreateEnum
CREATE TYPE "PlatformExpenseCategory" AS ENUM ('HOSTING', 'SERVER', 'DATABASE', 'MARKETING', 'DEVELOPMENT', 'WHATSAPP', 'PAYMENT_GATEWAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformExpenseFrequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'ANNUAL');

-- CreateTable
CREATE TABLE "platform_expenses" (
    "id" TEXT NOT NULL,
    "category" "PlatformExpenseCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amountInr" DECIMAL(10,2) NOT NULL,
    "frequency" "PlatformExpenseFrequency" NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_expenses_category_idx" ON "platform_expenses"("category");
