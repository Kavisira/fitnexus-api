-- CreateEnum
CREATE TYPE "PtDuration" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PT_EXPIRY';

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "hasPersonalTrainer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptDuration" "PtDuration",
ADD COLUMN     "ptEndDate" TIMESTAMP(3),
ADD COLUMN     "ptRatePerMonth" DECIMAL(10,2),
ADD COLUMN     "ptStartDate" TIMESTAMP(3),
ADD COLUMN     "ptTotal" DECIMAL(10,2);
