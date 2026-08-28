-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "goalWeightKg" DECIMAL(5,2),
ADD COLUMN     "heightCm" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "member_metric_entries" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightKg" DECIMAL(5,2) NOT NULL,
    "chestCm" DECIMAL(5,2),
    "waistCm" DECIMAL(5,2),
    "hipsCm" DECIMAL(5,2),
    "bmi" DECIMAL(4,1) NOT NULL,
    "bmiStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_metric_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_metric_entries_memberId_recordedAt_idx" ON "member_metric_entries"("memberId", "recordedAt");

-- AddForeignKey
ALTER TABLE "member_metric_entries" ADD CONSTRAINT "member_metric_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
