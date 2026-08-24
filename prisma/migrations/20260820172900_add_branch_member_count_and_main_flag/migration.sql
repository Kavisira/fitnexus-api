-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memberCount" INTEGER NOT NULL DEFAULT 0;
