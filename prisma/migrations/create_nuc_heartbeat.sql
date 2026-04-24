-- =============================================================================
-- create_nuc_heartbeat.sql
--
-- Stores the latest NUC brain engine heartbeat. The NUC pushes health data
-- to Aegis every 60s via POST /api/v1/engine/heartbeat, solving the problem
-- where Vercel can't reach the NUC's Tailscale IP (100.84.113.47).
--
-- Single-row design: one row per NUC node (keyed on nodeId). The coordinator
-- upserts its row each tick; future worker NUCs will add their own rows.
--
-- Run with:
--   psql $DATABASE_URL -f prisma/migrations/create_nuc_heartbeat.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "NucHeartbeat" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "nodeId"          TEXT NOT NULL,
  "nodeRole"        TEXT NOT NULL DEFAULT 'coordinator',
  "engineVersion"   TEXT,
  "status"          TEXT NOT NULL DEFAULT 'online',
  "moduleStatus"    JSONB DEFAULT '{}'::jsonb,
  "latencyMs"       INTEGER,
  "uptimeSeconds"   INTEGER,
  "errorCount"      INTEGER DEFAULT 0,
  "lastScanAt"      TIMESTAMPTZ,
  "meta"            JSONB DEFAULT '{}'::jsonb,
  "receivedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "NucHeartbeat_pkey" PRIMARY KEY ("id")
);

-- Fast lookup by nodeId (most queries) and recency
CREATE UNIQUE INDEX IF NOT EXISTS "NucHeartbeat_nodeId_key" ON "NucHeartbeat" ("nodeId");
CREATE INDEX IF NOT EXISTS "idx_nucheartbeat_received" ON "NucHeartbeat" ("receivedAt" DESC);
