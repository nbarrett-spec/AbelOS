#!/usr/bin/env node
/**
 * test-qc-gate.mjs
 *
 * Exercises the QC gate wired into /api/ops/manufacturing/advance-job.
 *
 * Steps:
 *   1. Create a test Job with status = IN_PRODUCTION, qcRequired = false.
 *      (qcRequired is the legacy manufacturing gate; the new QC GATE is
 *       independent of it — it triggers on any IN_PRODUCTION → LOADED
 *       transition regardless.)
 *   2. Try to advance IN_PRODUCTION → STAGED — allowed (gate only fires
 *      on pre-ship targets LOADED/IN_TRANSIT/DELIVERED).
 *   3. Flip back to IN_PRODUCTION via direct SQL update to re-exercise the
 *      failing path without assuming other gates.
 *   4. Try to advance IN_PRODUCTION → STAGED → LOADED without an inspection
 *      — the LOADED hop expects 409 blocked.
 *   5. Insert a PASS row into "Inspection" for the Job.
 *   6. Retry STAGED → LOADED — expects 200 OK (or at least: no longer 409).
 *   7. Clean up the test Job + Inspection.
 *
 * Prints PASS/FAIL per step. Exits 0 if every assertion holds.
 *
 * Env:
 *   BASE_URL   — defaults to http://localhost:3000
 *   DEV_BEARER — optional dev bearer token. If unset, also tries via x-staff-*
 *                headers which bypass auth in dev.
 */

import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const prisma = new PrismaClient()

// Load JWT_SECRET from .env so we can forge a valid staff cookie for the test.
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  try {
    const env = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    const line = env.split(/\r?\n/).find((l) => l.startsWith('JWT_SECRET='))
    if (!line) return 'dev-secret-change-in-production'
    const raw = line.slice('JWT_SECRET='.length).trim()
    return raw.replace(/^['"]|['"]$/g, '')
  } catch {
    return 'dev-secret-change-in-production'
  }
}

async function buildAuthCookie() {
  const secret = new TextEncoder().encode(loadJwtSecret())
  const jwt = await new SignJWT({
    staffId: 'test-qc-gate',
    email: 'gate@test.local',
    firstName: 'Gate',
    lastName: 'Tester',
    role: 'ADMIN',
    roles: 'ADMIN',
    department: 'EXECUTIVE',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret)
  return `abel_staff_session=${jwt}`
}

let cookieHeader = ''
const baseHeaders = {
  'Content-Type': 'application/json',
  origin: BASE_URL,
}

const results = []

function log(name, pass, note = '') {
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${name}${note ? ` — ${note}` : ''}`)
  results.push({ name, pass, note })
}

async function advance(jobId, targetStatus, extra = {}) {
  const res = await fetch(`${BASE_URL}/api/ops/manufacturing/advance-job`, {
    method: 'POST',
    headers: { ...baseHeaders, cookie: cookieHeader },
    body: JSON.stringify({ jobId, targetStatus, ...extra }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function main() {
  console.log(`\nQC Gate Test — base ${BASE_URL}\n`)
  cookieHeader = await buildAuthCookie()

  // 1. Create Job in IN_PRODUCTION
  const jobNumber = `JOB-QCGATE-${Date.now().toString(36)}`
  let job
  try {
    // Use raw SQL because test job doesn't need full Prisma relations.
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO "Job" (id, "jobNumber", "builderName", status, "scopeType", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'QC Test Builder', 'IN_PRODUCTION', 'DOORS_ONLY', NOW(), NOW())
       RETURNING id, "jobNumber", status::text as status`,
      jobNumber
    )
    job = rows[0]
    log('create IN_PRODUCTION job', !!job, job?.jobNumber)
  } catch (e) {
    log('create IN_PRODUCTION job', false, e.message)
    process.exit(1)
  }

  // 2. IN_PRODUCTION → STAGED should NOT be blocked by the QC gate itself
  //    (gate fires on pre-ship targets). It may be blocked by the material
  //    verification gate, which is fine — we only care that it isn't a 409
  //    blocked-by-qc response.
  let r = await advance(job.id, 'STAGED')
  log(
    'IN_PRODUCTION → STAGED is NOT QC-gated',
    r.status !== 409 || r.body?.reason !== 'qc_required',
    `status=${r.status}${r.body?.reason ? ` reason=${r.body.reason}` : ''}`
  )

  // Force-advance to STAGED via raw SQL so we can test the LOADED gate.
  await prisma.$executeRawUnsafe(
    `UPDATE "Job" SET status = 'STAGED'::"JobStatus", "updatedAt" = NOW() WHERE id = $1`,
    job.id
  )

  // 3. STAGED → LOADED with NO passing inspection — expect 409 blocked.
  r = await advance(job.id, 'LOADED')
  const blockedNoInsp =
    r.status === 409 &&
    r.body?.blocked === true &&
    (r.body?.reason === 'qc_required' || r.body?.reason === 'qc_failed_unresolved')
  log(
    'STAGED → LOADED WITHOUT inspection returns 409',
    blockedNoInsp,
    `status=${r.status} reason=${r.body?.reason || 'n/a'}`
  )

  // 4. Seed an InspectionTemplate if needed, then insert a PASS Inspection.
  const tpl = await prisma.$queryRawUnsafe(
    `SELECT id FROM "InspectionTemplate" WHERE code = 'MFG_QC' LIMIT 1`
  )
  let templateId = tpl[0]?.id
  if (!templateId) {
    const created = await prisma.$queryRawUnsafe(
      `INSERT INTO "InspectionTemplate" ("id","name","code","category","items")
       VALUES (gen_random_uuid()::text, 'QC Gate Test', 'QC_GATE_TEST', 'MANUFACTURING', '[]'::jsonb)
       RETURNING id`
    )
    templateId = created[0].id
  }
  const inspRows = await prisma.$queryRawUnsafe(
    `INSERT INTO "Inspection" ("id","templateId","jobId","status","completedDate","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'PASS', NOW(), NOW(), NOW())
     RETURNING id`,
    templateId, job.id
  )
  const inspectionId = inspRows[0].id
  log('seed PASS inspection', !!inspectionId, inspectionId)

  // 5. Retry STAGED → LOADED with PASS inspection — expect NOT 409 qc_required.
  r = await advance(job.id, 'LOADED')
  const notBlocked = !(r.status === 409 && r.body?.reason === 'qc_required')
  log(
    'STAGED → LOADED WITH PASS inspection is NOT qc-blocked',
    notBlocked,
    `status=${r.status}${r.body?.error ? ` err=${r.body.error}` : ''}`
  )

  // 6. Cleanup.
  await prisma.$executeRawUnsafe(`DELETE FROM "Inspection" WHERE id = $1`, inspectionId)
  await prisma.$executeRawUnsafe(`DELETE FROM "Job" WHERE id = $1`, job.id)
  log('cleanup test rows', true)

  const failures = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failures.length}/${results.length} steps passed`)
  if (failures.length > 0) {
    console.log('Failed:')
    for (const f of failures) console.log(`  - ${f.name} (${f.note})`)
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error('FATAL', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
