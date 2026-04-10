-- Migration V4: Floor Plan Upload & Management
-- Adds FloorPlan table for storing floor plan documents linked to projects, takeoffs, and quotes

CREATE TABLE IF NOT EXISTS "FloorPlan" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId"    TEXT NOT NULL,
  "label"        TEXT NOT NULL DEFAULT 'Floor Plan',
  "fileName"     TEXT NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "fileSize"     INTEGER NOT NULL,
  "fileType"     TEXT NOT NULL,
  "pageCount"    INTEGER,
  "version"      INTEGER NOT NULL DEFAULT 1,
  "notes"        TEXT,
  "uploadedById" TEXT,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FloorPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE,
  CONSTRAINT "FloorPlan_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Staff"("id") ON DELETE SET NULL
);

CREATE INDEX "FloorPlan_projectId_idx" ON "FloorPlan"("projectId");
CREATE INDEX "FloorPlan_active_idx" ON "FloorPlan"("active");

-- Add optional floorPlanId references to Takeoff and Quote tables
ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "floorPlanId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "floorPlanId" TEXT;

-- Add foreign key constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Takeoff_floorPlanId_fkey') THEN
    ALTER TABLE "Takeoff" ADD CONSTRAINT "Takeoff_floorPlanId_fkey"
      FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_floorPlanId_fkey') THEN
    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_floorPlanId_fkey"
      FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE SET NULL;
  END IF;
END
$$;
