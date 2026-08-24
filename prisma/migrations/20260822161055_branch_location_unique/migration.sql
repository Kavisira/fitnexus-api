/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,address,city,state,country]` on the table `branches` will be added. If there are existing duplicate values, this will fail.
  - Made the column `address` on table `branches` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "branches" ALTER COLUMN "address" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "branches_organizationId_address_city_state_country_key" ON "branches"("organizationId", "address", "city", "state", "country");
