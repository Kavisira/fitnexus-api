/*
  Warnings:

  - The `role` column on the `employees` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "employees" DROP COLUMN "role",
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'OTHER';

-- DropEnum
DROP TYPE "EmployeeRole";

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_organizationId_name_key" ON "job_titles"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
