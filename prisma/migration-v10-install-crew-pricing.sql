-- Migration V10: Install Crew & Subcontractor Per-SqFt Pricing
-- Adds pricePerSqFt to SubcontractorPricing table
-- Adds isSubcontractor and companyName to Crew table for subcontractor tracking

-- ============================================================================
-- 1. Add subcontractor fields to Crew table
-- ============================================================================
ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "isSubcontractor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "companyName" TEXT; -- e.g., "DFW Door and Trim"
ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;

-- ============================================================================
-- 2. Add pricePerSqFt to SubcontractorPricing table
-- ============================================================================
ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricePerSqFt" FLOAT NOT NULL DEFAULT 0;
ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricingType" TEXT NOT NULL DEFAULT 'PER_SQFT'; -- PER_SQFT, PER_UNIT, FLAT_RATE

-- ============================================================================
-- 3. Add useful indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS "Crew_isSubcontractor_idx" ON "Crew" ("isSubcontractor") WHERE "isSubcontractor" = true;
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_crewId_builderId_idx" ON "SubcontractorPricing" ("crewId", "builderId");
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_active_idx" ON "SubcontractorPricing" ("active") WHERE "active" = true;
