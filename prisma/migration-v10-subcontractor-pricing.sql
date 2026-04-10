-- Migration: Add SubcontractorPricing table for tracking crew vs subcontractor pricing

CREATE TABLE IF NOT EXISTS "SubcontractorPricing" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL REFERENCES "Crew"("id") ON DELETE CASCADE,
  "builderId" TEXT REFERENCES "Builder"("id") ON DELETE SET NULL,
  "pricePerDoor" FLOAT NOT NULL DEFAULT 0,
  "pricePerHardwareSet" FLOAT NOT NULL DEFAULT 0,
  "pricePerTrimPiece" FLOAT NOT NULL DEFAULT 0,
  "pricePerWindow" FLOAT NOT NULL DEFAULT 0,
  "flatRatePerUnit" FLOAT,
  "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubcontractorPricing_pkey" PRIMARY KEY ("id")
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_crewId_idx" ON "SubcontractorPricing" ("crewId");
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_builderId_idx" ON "SubcontractorPricing" ("builderId");
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_active_idx" ON "SubcontractorPricing" ("active") WHERE "active" = true;
CREATE INDEX IF NOT EXISTS "SubcontractorPricing_effectiveDate_idx" ON "SubcontractorPricing" ("effectiveDate");
