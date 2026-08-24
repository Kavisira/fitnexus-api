/*
  Warnings:

  - You are about to drop the column `city` on the `branches` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `branches` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `branches` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `branches` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[organizationId,location]` on the table `branches` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `location` to the `branches` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "branches_organizationId_address_city_state_country_key";

-- AlterTable
ALTER TABLE "branches" DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "name",
DROP COLUMN "state",
ADD COLUMN     "location" TEXT NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "currency" SET DEFAULT 'INR',
ALTER COLUMN "taxRatePercent" DROP DEFAULT,
ALTER COLUMN "memberCount" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "branches_organizationId_location_key" ON "branches"("organizationId", "location");
