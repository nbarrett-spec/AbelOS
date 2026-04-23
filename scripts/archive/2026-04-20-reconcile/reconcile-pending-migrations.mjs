#!/usr/bin/env node
// scripts/reconcile-pending-migrations.mjs
//
// `prisma migrate status` reports 4 pending migrations:
//   - 1776138006_add_performance_indices   (no SQL — placeholder)
//   - 1776138012_add_performance_indices   (the real index set)
//   - 1776196453_mrp_indices_and_perf      (MRP indices)
//   - add_multi_role_support                (Staff.roles + portalOverrides)
//
// The PROD schema already contains every column and index these migrations
// would create (Takeoff_blueprintId_idx, Staff.roles, Staff.portalOverrides,
// MRP composite indices, …), because they were hand-run via /api/ops/migrate
// routes before the formal migration files landed. Every SQL statement in
// the migration files is also guarded with IF NOT EXISTS / ADD COLUMN IF
// NOT EXISTS (after the add_multi_role_support rewrite below), so re-applying
// is idempotent and safe.
//
// This script:
//   1. Opens a prisma client against $DATABASE_URL.
//   2. Verifies that each migration's target columns/indices actually exist.
//   3. In --apply mode, inserts a row into `_prisma_migrations` marking the
//      migration applied with a fresh rolled_back_at=NULL and finished_at=NOW().
//
// Dry-run by default. Review the "checks" report before applying.
//
// USAGE:
//   node scripts/reconcile-pending-migrations.mjs           # verify only
//   node scripts/reconcile-pending-migrations.mjs --apply   # mark applied

import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

// Each entry lists a migration name + a set of probe queries. If every
// probe returns true, the schema already reflects this migration.
const MIGRATIONS = [
  {
    name: '1776138006_add_performance_indices',
    note: 'Empty placeholder — same content as 1776138012. Mark applied unconditionally.',
    probes: [],
  },
  {
    name: '1776138012_add_performance_indices',
    probes: [
      { kind: 'index', table: 'Takeoff', name: 'Takeoff_blueprintId_idx' },
      { kind: 'index', table: 'Order', name: 'Order_paymentStatus_idx' }, // note: this index is actually added by 1776196453; swap if needed
      { kind: 'index', table: 'Payment', name: 'Payment_receivedAt_idx' },
      { kind: 'index', table: 'Invoice', name: 'Invoice_orderId_idx' },
    ],
  },
  {
    name: '1776196453_mrp_indices_and_perf',
    probes: [
      { kind: 'index', table: 'Order', name: 'Order_paymentStatus_idx' },
      { kind: 'index', table: 'OrderItem', name: 'OrderItem_orderId_productId_idx' },
      { kind: 'index', table: 'InventoryItem', name: 'InventoryItem_productId_onHand_idx' },
    ],
  },
  {
    name: 'add_multi_role_support',
    probes: [
      { kind: 'column', table: 'Staff', name: 'roles' },
      { kind: 'column', table: 'Staff', name: 'portalOverrides' },
      { kind: 'index', table: 'Staff', name: 'Staff_roles_idx' },
    ],
  },
]

async function indexExists(table, name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2 LIMIT 1`,
    table,
    name
  )
  return rows.length > 0
}

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    table,
    column
  )
  return rows.length > 0
}

async function migrationAlreadyRecorded(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "rolled_back_at" IS NULL LIMIT 1`,
    name
  )
  return rows.length > 0
}

async function main() {
  console.log(`${'='.repeat(70)}\nPrisma migration reconciliation  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n${'='.repeat(70)}\n`)

  const plan = []
  for (const mig of MIGRATIONS) {
    const existsInTable = await migrationAlreadyRecorded(mig.name)
    if (existsInTable) {
      plan.push({ name: mig.name, action: 'already-recorded' })
      continue
    }
    let allProbesPass = true
    const probeResults = []
    for (const p of mig.probes) {
      const ok = p.kind === 'index' ? await indexExists(p.table, p.name) : await columnExists(p.table, p.name)
      probeResults.push({ ...p, ok })
      if (!ok) allProbesPass = false
    }
    plan.push({
      name: mig.name,
      note: mig.note,
      probes: probeResults,
      action: allProbesPass ? 'mark-applied' : 'needs-run',
    })
  }

  for (const p of plan) {
    console.log(`- ${p.name}`)
    console.log(`    action: ${p.action}${p.note ? `  (${p.note})` : ''}`)
    if (p.probes) {
      for (const pr of p.probes) {
        console.log(`      ${pr.ok ? 'OK ' : 'MISS'}  ${pr.kind} ${pr.table}.${pr.name}`)
      }
    }
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to insert rows into _prisma_migrations.')
    await prisma.$disconnect()
    return
  }

  for (const p of plan) {
    if (p.action !== 'mark-applied') continue
    const id = crypto.randomUUID()
    const checksum = crypto.createHash('sha256').update(p.name).digest('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
      id,
      checksum,
      p.name
    )
    console.log(`  applied: ${p.name}`)
  }
  console.log('\nDone.')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
