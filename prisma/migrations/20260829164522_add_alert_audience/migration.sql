-- CreateEnum
CREATE TYPE "AlertAudienceType" AS ENUM ('ALL', 'BRANCH', 'USER');

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "audienceBranchId" TEXT,
ADD COLUMN     "audienceType" "AlertAudienceType" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "audienceUserId" TEXT;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_audienceBranchId_fkey" FOREIGN KEY ("audienceBranchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_audienceUserId_fkey" FOREIGN KEY ("audienceUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
