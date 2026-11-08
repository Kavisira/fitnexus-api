-- CreateTable
CREATE TABLE "member_payments" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_payments_memberId_paidAt_idx" ON "member_payments"("memberId", "paidAt");

-- AddForeignKey
ALTER TABLE "member_payments" ADD CONSTRAINT "member_payments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
