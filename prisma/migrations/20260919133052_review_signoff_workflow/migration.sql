-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_EMPLOYEE', 'PENDING_MANAGEMENT', 'SIGNED_OFF');

-- CreateEnum
CREATE TYPE "ReviewResponseAuthor" AS ENUM ('EMPLOYEE', 'MANAGEMENT');

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "signedOffAt" TIMESTAMP(3),
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_EMPLOYEE';

-- CreateTable
CREATE TABLE "review_responses" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "authorType" "ReviewResponseAuthor" NOT NULL,
    "authorUserId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_responses_reviewId_idx" ON "review_responses"("reviewId");

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
