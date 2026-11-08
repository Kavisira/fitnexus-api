-- AlterTable
ALTER TABLE "member_metric_entries" ADD COLUMN     "armsCm" DECIMAL(5,2),
ADD COLUMN     "calfCm" DECIMAL(5,2),
ADD COLUMN     "shouldersCm" DECIMAL(5,2),
ADD COLUMN     "thighCm" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "amountPaid" DECIMAL(10,2),
ADD COLUMN     "notifyGymOnPaymentDue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMemberOnPaymentDue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentFollowUpDate" TIMESTAMP(3);
