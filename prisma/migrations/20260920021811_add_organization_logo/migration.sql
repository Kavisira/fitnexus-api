-- Add optional logo URL to Organization, uploaded once in Organization
-- Settings (Owner-only) and reused wherever the org's identity needs
-- to appear in a generated document (payslip PDFs today).
ALTER TABLE "organizations" ADD COLUMN "logoUrl" TEXT;
