-- Migration: add_builder_referral_table
-- Applied: 2026-04-18 via Supabase MCP
-- Purpose: BuilderReferral table for builder-to-builder referral program

DO $$ BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONTACTED', 'SIGNED_UP', 'FIRST_ORDER', 'CREDITED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE "BuilderReferral" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "referredCompany" TEXT NOT NULL,
  "referredContact" TEXT NOT NULL,
  "referredEmail" TEXT NOT NULL,
  "referredPhone" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "notes" TEXT,
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "referredBuilderId" TEXT,
  "creditAmount" DOUBLE PRECISION NOT NULL DEFAULT 250,
  "referrerCredited" BOOLEAN NOT NULL DEFAULT false,
  "referreeCredited" BOOLEAN NOT NULL DEFAULT false,
  "creditedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BuilderReferral_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BuilderReferral" ADD CONSTRAINT "BuilderReferral_referralCode_key" UNIQUE ("referralCode");

CREATE INDEX "BuilderReferral_referrerId_idx" ON "BuilderReferral"("referrerId");
CREATE INDEX "BuilderReferral_status_idx" ON "BuilderReferral"("status");
CREATE INDEX "BuilderReferral_referredBuilderId_idx" ON "BuilderReferral"("referredBuilderId");

ALTER TABLE "BuilderReferral" ADD CONSTRAINT "BuilderReferral_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuilderReferral" ADD CONSTRAINT "BuilderReferral_referredBuilderId_fkey"
  FOREIGN KEY ("referredBuilderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
