-- =============================================================================
-- create_staff_preferences.sql
--
-- Creates the StaffPreferences table for dark mode, accent color, font size,
-- compact mode, sidebar state, and dashboard layout persistence.
--
-- Run with:
--   psql $DATABASE_URL -f prisma/migrations/create_staff_preferences.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "StaffPreferences" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "staffId"          TEXT NOT NULL,
  "theme"            TEXT NOT NULL DEFAULT 'system',
  "accentColor"      TEXT NOT NULL DEFAULT '#C6A24E',
  "fontSize"         TEXT NOT NULL DEFAULT 'medium',
  "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
  "compactMode"      BOOLEAN NOT NULL DEFAULT false,
  "dashboardLayout"  JSONB DEFAULT '{}'::jsonb,
  "hiddenSections"   JSONB DEFAULT '[]'::jsonb,
  "pinnedSections"   JSONB DEFAULT '[]'::jsonb,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "StaffPreferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffPreferences_staffId_key" UNIQUE ("staffId")
);

CREATE INDEX IF NOT EXISTS "StaffPreferences_staffId_idx" ON "StaffPreferences" ("staffId");
