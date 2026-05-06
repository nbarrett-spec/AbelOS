// One-off: apply NucHeartbeat table + indexes to prod Neon.
// Idempotent via IF NOT EXISTS. Safe to re-run.
// Delete this script after the deploy lands.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Prisma's $executeRawUnsafe runs one statement per call (prepared-statement
// mode). Split DDL into separate executions.

const CREATE_TABLE_SQL = `
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
)
`

const CREATE_UNIQUE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "NucHeartbeat_nodeId_key" ON "NucHeartbeat" ("nodeId")`
const CREATE_RECEIVED_INDEX_SQL = `CREATE INDEX IF NOT EXISTS "idx_nucheartbeat_received" ON "NucHeartbeat" ("receivedAt" DESC)`

const VERIFY_SQL = `
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'NucHeartbeat'
ORDER BY ordinal_position
`

async function main() {
  console.log('Applying NucHeartbeat migration...')
  console.log('  [1/3] CREATE TABLE NucHeartbeat...')
  await prisma.$executeRawUnsafe(CREATE_TABLE_SQL)
  console.log('  [2/3] CREATE UNIQUE INDEX on nodeId...')
  await prisma.$executeRawUnsafe(CREATE_UNIQUE_INDEX_SQL)
  console.log('  [3/3] CREATE INDEX on receivedAt DESC...')
  await prisma.$executeRawUnsafe(CREATE_RECEIVED_INDEX_SQL)
  console.log('Applied.')

  const rows = await prisma.$queryRawUnsafe(VERIFY_SQL)
  console.log('Verify — columns in NucHeartbeat:')
  console.log(JSON.stringify(rows, null, 2))
  if (!Array.isArray(rows) || rows.length < 13) {
    throw new Error(`Expected 13 columns, found ${Array.isArray(rows) ? rows.length : 'none'}`)
  }
  console.log('OK — NucHeartbeat table ready for heartbeats.')
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
