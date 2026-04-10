-- Migration V8: Password Reset Columns + Staff Reset Token + Production Cleanup
-- Run against your Neon database BEFORE deploying the next build

-- ============================================================================
-- 1. Add password reset columns to Builder table
-- ============================================================================
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

-- Index for fast token lookup during password reset
CREATE INDEX IF NOT EXISTS "Builder_resetToken_idx" ON "Builder" ("resetToken") WHERE "resetToken" IS NOT NULL;

-- ============================================================================
-- 2. Add password reset columns to Staff table (for ops/staff forgot-password)
-- ============================================================================
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Staff_resetToken_idx" ON "Staff" ("resetToken") WHERE "resetToken" IS NOT NULL;

-- ============================================================================
-- 3. Create StaffRoles join table if it doesn't exist (multi-role support)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "StaffRoles" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL REFERENCES "Staff"("id") ON DELETE CASCADE,
  "role" "StaffRole" NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRoles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffRoles_staffId_role_key" UNIQUE ("staffId", "role")
);

CREATE INDEX IF NOT EXISTS "StaffRoles_staffId_idx" ON "StaffRoles" ("staffId");

-- Backfill: ensure every existing staff member has their primary role in StaffRoles
INSERT INTO "StaffRoles" ("id", "staffId", "role", "assignedAt")
SELECT
  gen_random_uuid()::text,
  s."id",
  s."role",
  COALESCE(s."createdAt", NOW())
FROM "Staff" s
WHERE NOT EXISTS (
  SELECT 1 FROM "StaffRoles" sr WHERE sr."staffId" = s."id" AND sr."role" = s."role"
);

-- ============================================================================
-- 4. Remove demo/test data (safe — skips if not present)
-- ============================================================================

-- Remove demo builder account
DELETE FROM "Builder" WHERE email = 'demo@abelbuilder.com';

-- Remove demo homeowner access
DELETE FROM "HomeownerAccess" WHERE "accessToken" = 'demo-homeowner-2026';

-- Remove test vendors with 555 phone numbers (only removes the seeded fakes)
-- NOTE: Comment these out if you want to keep the sample vendors
-- DELETE FROM "Vendor" WHERE phone LIKE '%(555)%';

-- ============================================================================
-- Done! Verify with:
--   SELECT "resetToken", "resetTokenExpiry" FROM "Builder" LIMIT 1;
--   SELECT "resetToken", "resetTokenExpiry" FROM "Staff" LIMIT 1;
--   SELECT COUNT(*) FROM "StaffRoles";
-- ============================================================================
