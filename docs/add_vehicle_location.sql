-- Migration: add_vehicle_location_table
-- Applied: 2026-04-18 via Supabase MCP
-- Purpose: VehicleLocation table for live fleet tracking (powers /ops/live-map)

CREATE TABLE "VehicleLocation" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "heading" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "address" TEXT,
  "activeDeliveryId" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VehicleLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleLocation_crewId_idx" ON "VehicleLocation"("crewId");
CREATE INDEX "VehicleLocation_vehicleId_idx" ON "VehicleLocation"("vehicleId");
CREATE INDEX "VehicleLocation_timestamp_idx" ON "VehicleLocation"("timestamp");
CREATE INDEX "VehicleLocation_activeDeliveryId_idx" ON "VehicleLocation"("activeDeliveryId");

ALTER TABLE "VehicleLocation" ADD CONSTRAINT "VehicleLocation_crewId_fkey"
  FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;
