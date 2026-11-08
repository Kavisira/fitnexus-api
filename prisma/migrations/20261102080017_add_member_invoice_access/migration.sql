-- CreateTable
CREATE TABLE "member_invoice_access" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_invoice_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_invoice_access_memberId_key" ON "member_invoice_access"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "member_invoice_access_token_key" ON "member_invoice_access"("token");

-- AddForeignKey
ALTER TABLE "member_invoice_access" ADD CONSTRAINT "member_invoice_access_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
