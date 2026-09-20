-- CreateIndex
CREATE INDEX "leads_organizationId_branchId_idx" ON "leads"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "leads_nextFollowUpAt_status_idx" ON "leads"("nextFollowUpAt", "status");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");
