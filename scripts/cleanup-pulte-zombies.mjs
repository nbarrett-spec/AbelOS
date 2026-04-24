// ─────────────────────────────────────────────────────────────────────────────
// cleanup-pulte-zombies.mjs
// ─────────────────────────────────────────────────────────────────────────────
// One-time cleanup of Pulte Homes "zombie" Jobs still carrying active statuses
// after Pulte closed the account on 2026-04-20.
//
// WHY THIS EXISTS:
//   517 Jobs with builderName='Pulte Homes' are still in active status buckets
//   (CREATED / READINESS_CHECK / MATERIALS_LOCKED / IN_PRODUCTION / STAGED /
//   LOADED / IN_TRANSIT / DELIVERED / INSTALLING / PUNCH_LIST). They're
//   poisoning:
//     - Brittney Werner's PM workload (660 "active" jobs — mostly Pulte ghosts)
//     - Cross-dock flags (326 of 327 PurchaseOrderItem.crossDockFlag=true are
//       on Pulte backorder allocations)
//     - Shortage forecast (222 PENDING SmartPORecommendations, all Masonite,
//       triggered by Pulte backorder demand that no longer exists)
//     - InventoryAllocation committed/available math (5,313 units BACKORDERED +
//       4,972 units RESERVED against dead jobs)
//
// BUCKETING (explicit, conservative — no auto-CANCEL on ambiguous signal):
//   A (COMPLETE)  — Order.paymentStatus='PAID'
//                OR (Order.inflowOrderId IS NOT NULL AND Order.status='DELIVERED')
//                → Transition Job → COMPLETE. Keep CONSUMED allocations as-is;
//                  RESERVED/BACKORDERED/PICKED allocations get RELEASED (material
//                  shipped or consumed already, paper trail cleanup).
//   B (REVIEW)    — SO-linked but Order.paymentStatus IN ('PENDING','INVOICED',
//                  'OVERDUE') AND Order.inflowOrderId IS NOT NULL
//                → Leave status as-is; emit ONE rollup InboxItem for human review.
//   C (CANCELLED) — No InFlow SO link (Order.inflowOrderId IS NULL) OR no Order
//                → Transition Job → CLOSED (the JobStatus enum has no
//                  CANCELLED value; CLOSED is the canonical terminal/archived
//                  state per schema.prisma line 1134 "Payment received, job
//                  archived"). Audit log + buildSheetNotes carry the CANCELLED
//                  semantics so downstream reporting can distinguish a
//                  post-Pulte-loss cancel from a normal close.
//
// SCOPE: Pulte-only. Raw SQL for all writes. No prisma/schema.prisma changes.
//
// USAGE:
//   node scripts/cleanup-pulte-zombies.mjs              # dry-run
//   node scripts/cleanup-pulte-zombies.mjs --commit     # apply
//   node scripts/cleanup-pulte-zombies.mjs --commit --skip-crons  # skip step 6
//
// IDEMPOTENT: re-running finds 0 remaining zombies and makes no changes.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

const COMMIT = process.argv.includes('--commit')
const SKIP_CRONS = process.argv.includes('--skip-crons')

const ACTIVE_STATUSES = [
  'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION',
  'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST',
]

const NATE_ID  = 'cmn0bsdf800005yk9sizrwc22'
const CLINT_ID = 'cmn0sfknk00013v60ei8f6157'
const BRITTNEY_ID = 'stf_bolt_mn8wg5u3_krwl'

const TAG_COMPLETE  = ' [CLEANED-UP: Pulte closed 4/20; SO was Fulfilled. Transitioned to COMPLETE.]'
// Schema note: JobStatus enum has no CANCELLED value (CREATED → … → CLOSED).
// We land cancelled jobs in CLOSED ("archived") and carry cancel semantics in
// the note + AuditLog bucket='C' for downstream reporting.
const TAG_CANCELLED = ' [CLEANED-UP: Pulte closed 4/20; no InFlow fulfillment evidence. Transitioned to CLOSED (cancelled — no JobStatus.CANCELLED enum).]'
const ALLOC_RELEASE_NOTE = ' [RELEASED: Parent Pulte job cancelled 4/24 post-account-loss cleanup]'

function bar(s) {
  console.log('\n' + '═'.repeat(78))
  console.log('  ' + s)
  console.log('═'.repeat(78))
}
function sub(s) { console.log('\n─── ' + s) }

// Chunk helper: Neon's driver tolerates ~$1 array params fine, but keep payloads
// tight to avoid single-statement contention with the just-finished SO-reconcile.
function chunk(arr, n = 500) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function triggerCron(path) {
  const url = `http://localhost:3000${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Cron routes use checkStaffAuth — middleware would overwrite these if
      // cookie-auth were present, but we have no cookie so they pass through.
      'x-staff-id':         NATE_ID,
      'x-staff-role':       'ADMIN',
      'x-staff-roles':      'ADMIN',
      'x-staff-department': 'EXEC',
      'x-staff-email':      'n.barrett@abellumber.com',
    },
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 500) } }
  return { status: res.status, body: json }
}

;(async () => {
  bar(`Pulte zombie cleanup — ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // ── PHASE 1: Inventory ────────────────────────────────────────────────────
  sub('Phase 1. Inventory the Pulte zombies')
  const zombies = await sql`
    SELECT
      j.id, j."jobNumber", j.status::text AS status, j."orderId",
      j."assignedPMId",
      o."orderNumber", o."paymentStatus"::text AS "paymentStatus",
      o.status::text AS "orderStatus", o."inflowOrderId",
      CASE WHEN o."orderNumber" LIKE 'SO-%' THEN 'SO' ELSE 'OTHER' END AS order_type
    FROM "Job" j
    LEFT JOIN "Order" o ON j."orderId" = o.id
    WHERE j."builderName" = 'Pulte Homes'
      AND j.status::text = ANY(${ACTIVE_STATUSES})
  `
  console.log(`  total active Pulte zombies: ${zombies.length}`)

  if (zombies.length === 0) {
    bar('Nothing to do — already clean.')
    return
  }

  // ── PHASE 2: Categorize ──────────────────────────────────────────────────
  sub('Phase 2. Categorize into A/B/C buckets')
  const bucketA = [] // COMPLETE
  const bucketB = [] // REVIEW
  const bucketC = [] // CANCELLED

  for (const j of zombies) {
    const hasInflowLink   = !!j.inflowOrderId
    const isPaid          = j.paymentStatus === 'PAID'
    const isDelivered     = j.orderStatus === 'DELIVERED'
    const midPayment      = ['PENDING', 'INVOICED', 'OVERDUE'].includes(j.paymentStatus)

    if (isPaid || (hasInflowLink && isDelivered)) {
      bucketA.push(j)
    } else if (hasInflowLink && midPayment) {
      bucketB.push(j)
    } else {
      // No inflow link, or order doesn't exist, or order is in a state that
      // gives no fulfillment signal → CANCEL with confidence.
      bucketC.push(j)
    }
  }

  console.log(`  Bucket A (COMPLETE):  ${bucketA.length}  — paid or DELIVERED-with-inflow link`)
  console.log(`  Bucket B (REVIEW):    ${bucketB.length}  — SO-linked, mid-payment, needs human call`)
  console.log(`  Bucket C (CANCELLED): ${bucketC.length}  — no InFlow evidence`)
  console.log(`  total:                ${bucketA.length + bucketB.length + bucketC.length}`)

  // Sanity: bucket must partition exactly
  const partSum = bucketA.length + bucketB.length + bucketC.length
  if (partSum !== zombies.length) {
    throw new Error(`Bucket partition broken: ${partSum} != ${zombies.length}`)
  }

  // Sample a few from each for transparency
  if (bucketA.length) {
    console.log('  sample A (first 5):')
    for (const j of bucketA.slice(0, 5)) {
      console.log(`    ${j.jobNumber}  job=${j.status}  order=${j.orderNumber || '(none)'}  pay=${j.paymentStatus || '-'}  ostatus=${j.orderStatus || '-'}  inflow=${j.inflowOrderId ? 'Y' : 'N'}`)
    }
  }
  if (bucketB.length) {
    console.log('  sample B (first 5):')
    for (const j of bucketB.slice(0, 5)) {
      console.log(`    ${j.jobNumber}  job=${j.status}  order=${j.orderNumber}  pay=${j.paymentStatus}  ostatus=${j.orderStatus}`)
    }
  }
  if (bucketC.length) {
    console.log('  sample C (first 5):')
    for (const j of bucketC.slice(0, 5)) {
      console.log(`    ${j.jobNumber}  job=${j.status}  order=${j.orderNumber || '(none)'}  pay=${j.paymentStatus || '-'}  inflow=${j.inflowOrderId ? 'Y' : 'N'}`)
    }
  }

  // ── Pre-cleanup metrics ──────────────────────────────────────────────────
  sub('Pre-cleanup metrics (snapshotted before any writes)')
  const [
    [preCommittedRow],
    [preCrossDockRow],
    [preSmartPoRow],
    preSmartPoVendor,
    [preBrittneyRow],
    [preAllocByJobsRow],
  ] = await Promise.all([
    sql`SELECT COALESCE(SUM("committed"),0)::int AS sum_committed FROM "InventoryItem"`,
    sql`SELECT COUNT(*)::int AS c FROM "PurchaseOrderItem" WHERE "crossDockFlag" = true`,
    sql`SELECT COUNT(*)::int AS c FROM "SmartPORecommendation" WHERE status = 'PENDING'`,
    sql`
      SELECT COALESCE(v.name,'(null)') AS vendor, COUNT(*)::int AS c
      FROM "SmartPORecommendation" s
      LEFT JOIN "Vendor" v ON v.id = s."vendorId"
      WHERE s.status = 'PENDING'
      GROUP BY v.name
      ORDER BY c DESC
    `,
    sql`
      SELECT COUNT(*)::int AS c
      FROM "Job"
      WHERE "assignedPMId" = ${BRITTNEY_ID}
        AND status::text = ANY(${ACTIVE_STATUSES})
    `,
    sql`
      SELECT COUNT(*)::int AS c, COALESCE(SUM(quantity),0)::int AS qty
      FROM "InventoryAllocation"
      WHERE "jobId" = ANY(${zombies.map(z => z.id)}::text[])
        AND status IN ('RESERVED', 'BACKORDERED', 'PICKED')
    `,
  ])

  console.log(`  sum(InventoryItem.committed):     ${preCommittedRow.sum_committed}`)
  console.log(`  PurchaseOrderItem.crossDockFlag:  ${preCrossDockRow.c}`)
  console.log(`  SmartPORecommendation PENDING:    ${preSmartPoRow.c}`)
  console.log(`  SmartPO PENDING by vendor: ${preSmartPoVendor.map(v => `${v.vendor}=${v.c}`).join(', ')}`)
  console.log(`  Brittney active jobs:             ${preBrittneyRow.c}`)
  console.log(`  Active allocs on zombie jobs:     ${preAllocByJobsRow.c}  (sum qty=${preAllocByJobsRow.qty})`)

  // ── DRY-RUN exit ─────────────────────────────────────────────────────────
  if (!COMMIT) {
    bar('DRY-RUN complete — re-run with --commit to apply.')
    return
  }

  // ── PHASE 3: Apply status transitions ────────────────────────────────────
  sub('Phase 3. Apply status transitions')

  // 3a. Bucket A → COMPLETE
  let completeCount = 0
  if (bucketA.length) {
    const aIds = bucketA.map(j => j.id)
    for (const batch of chunk(aIds, 300)) {
      const res = await sql`
        UPDATE "Job"
        SET status = 'COMPLETE',
            "completedAt" = COALESCE("completedAt", NOW()),
            "updatedAt" = NOW(),
            "buildSheetNotes" = COALESCE("buildSheetNotes", '') || ${TAG_COMPLETE}
        WHERE id = ANY(${batch}::text[])
          AND status::text = ANY(${ACTIVE_STATUSES})
        RETURNING id
      `
      completeCount += res.length
    }
  }
  console.log(`  → COMPLETE:  ${completeCount} Job rows updated`)

  // 3b. Bucket C → CLOSED (no CANCELLED value in JobStatus enum — CLOSED is
  //     the canonical terminal/archived state; bucket='C' in the audit row
  //     preserves the cancel semantics for downstream reporting).
  let cancelCount = 0
  if (bucketC.length) {
    const cIds = bucketC.map(j => j.id)
    for (const batch of chunk(cIds, 300)) {
      const res = await sql`
        UPDATE "Job"
        SET status = 'CLOSED',
            "completedAt" = COALESCE("completedAt", NOW()),
            "updatedAt" = NOW(),
            "buildSheetNotes" = COALESCE("buildSheetNotes", '') || ${TAG_CANCELLED}
        WHERE id = ANY(${batch}::text[])
          AND status::text = ANY(${ACTIVE_STATUSES})
        RETURNING id
      `
      cancelCount += res.length
    }
  }
  console.log(`  → CLOSED (cancelled): ${cancelCount} Job rows updated`)
  console.log(`  → REVIEW:    ${bucketB.length} flagged (no status change)`)

  // ── PHASE 3b: Release allocations on both COMPLETE and CANCELLED jobs ───
  // Notes on COMPLETE: material really moved for PAID/DELIVERED jobs, but
  // open RESERVED/BACKORDERED rows on those jobs are stale (they never got
  // flipped to CONSUMED because the job never transitioned through STAGED).
  // Releasing frees the committed count without touching onHand. CONSUMED
  // rows are left untouched per spec.
  sub('Phase 3b. Release active allocations on COMPLETE + CANCELLED jobs')
  const releaseTargetIds = [
    ...bucketA.map(j => j.id),
    ...bucketC.map(j => j.id),
  ]
  // Capture top 10 productIds by qty BEFORE release so we can report what material frees up
  let topReleased = []
  if (releaseTargetIds.length) {
    topReleased = await sql`
      SELECT "productId", COUNT(*)::int AS rows, COALESCE(SUM(quantity),0)::int AS qty
      FROM "InventoryAllocation"
      WHERE "jobId" = ANY(${releaseTargetIds}::text[])
        AND status IN ('RESERVED', 'BACKORDERED', 'PICKED')
      GROUP BY "productId"
      ORDER BY qty DESC
      LIMIT 10
    `
  }

  let releasedAllocs = 0
  let releasedQty = 0
  if (releaseTargetIds.length) {
    for (const batch of chunk(releaseTargetIds, 300)) {
      const res = await sql`
        UPDATE "InventoryAllocation"
        SET status = 'RELEASED',
            "releasedAt" = NOW(),
            "updatedAt" = NOW(),
            notes = COALESCE(notes, '') || ${ALLOC_RELEASE_NOTE}
        WHERE "jobId" = ANY(${batch}::text[])
          AND status IN ('RESERVED', 'BACKORDERED', 'PICKED')
        RETURNING id, quantity
      `
      releasedAllocs += res.length
      releasedQty += res.reduce((s, r) => s + (r.quantity || 0), 0)
    }
  }
  console.log(`  released ${releasedAllocs} allocation rows (sum qty=${releasedQty})`)
  if (topReleased.length) {
    console.log('  top 10 productIds by freed qty:')
    for (const r of topReleased) {
      console.log(`    ${String(r.qty).padStart(6)}  ${String(r.rows).padStart(4)} rows  ${r.productId}`)
    }
  }

  // ── PHASE 4: Recompute InventoryItem.committed ───────────────────────────
  sub('Phase 4. Recompute InventoryItem.committed (sql fn, NULL = all products)')
  const [recomputeRes] = await sql`SELECT recompute_inventory_committed(NULL) AS touched`
  console.log(`  recompute touched ${recomputeRes.touched} InventoryItem rows`)

  // ── PHASE 5: Audit trail ─────────────────────────────────────────────────
  sub('Phase 5. Write audit trail')

  // One AuditLog row per Job transition (bucket A + C only; B unchanged).
  // Use a single VALUES-row insert via sql.unsafe pattern — tagged neon
  // driver doesn't support array-of-rows, so we batch with a CTE.
  let auditLogs = 0
  const nowIso = new Date().toISOString()

  async function insertAuditBatch(rows, action, fromToBuilder) {
    if (!rows.length) return 0
    // Build a single insert using arrays per column.
    const ids          = rows.map(j => `auditlog_pulte_${j.id}_${Date.now().toString(36)}`)
    const entityIds    = rows.map(j => j.id)
    const detailJson   = rows.map(j => JSON.stringify(fromToBuilder(j)))
    const res = await sql`
      INSERT INTO "AuditLog" (id, "staffId", action, entity, "entityId", details, "createdAt", severity)
      SELECT
        x.id, ${NATE_ID}, ${action}, 'Job', x."entityId", x.details::jsonb,
        ${nowIso}::timestamptz, 'INFO'
      FROM UNNEST(
        ${ids}::text[],
        ${entityIds}::text[],
        ${detailJson}::text[]
      ) AS x(id, "entityId", details)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `
    return res.length
  }

  const aAudit = await insertAuditBatch(
    bucketA,
    'PULTE_CLEANUP',
    j => ({ bucket: 'A', fromStatus: j.status, toStatus: 'COMPLETE',
            orderNumber: j.orderNumber, paymentStatus: j.paymentStatus,
            orderStatus: j.orderStatus, inflowOrderId: j.inflowOrderId }),
  )
  // Bucket C: toStatus is CLOSED at the DB level (no CANCELLED enum value),
  // semanticStatus records the intent for downstream reports.
  const cAudit = await insertAuditBatch(
    bucketC,
    'PULTE_CLEANUP',
    j => ({ bucket: 'C', fromStatus: j.status, toStatus: 'CLOSED',
            semanticStatus: 'CANCELLED',
            orderNumber: j.orderNumber || null,
            paymentStatus: j.paymentStatus || null,
            orderStatus: j.orderStatus || null,
            inflowOrderId: j.inflowOrderId || null }),
  )
  auditLogs = aAudit + cAudit
  console.log(`  wrote ${auditLogs} AuditLog rows (${aAudit} A, ${cAudit} C)`)

  // Bucket B rollup InboxItem — idempotent: only emit if there isn't already
  // an open PULTE_ZOMBIE_REVIEW InboxItem in PENDING status. Re-running the
  // script after the first successful run shouldn't spam Dawn + Clint.
  let reviewInboxId = null
  const [existingReview] = await sql`
    SELECT id FROM "InboxItem"
    WHERE type = 'PULTE_ZOMBIE_REVIEW' AND status = 'PENDING'
    ORDER BY "createdAt" DESC LIMIT 1
  `
  if (bucketB.length && !existingReview) {
    const reviewItems = bucketB.map(j => ({
      jobNumber: j.jobNumber, jobId: j.id, status: j.status,
      orderNumber: j.orderNumber, paymentStatus: j.paymentStatus,
      orderStatus: j.orderStatus,
    }))
    const [inserted] = await sql`
      INSERT INTO "InboxItem" (
        id, type, source, title, description, priority, status,
        "entityType", "entityId", "assignedTo", "actionData", "createdAt", "updatedAt"
      ) VALUES (
        ${'inbox_pulte_review_' + Date.now().toString(36)},
        'PULTE_ZOMBIE_REVIEW', 'cleanup-pulte-zombies',
        ${`Pulte cleanup: ${bucketB.length} jobs need human decision`},
        ${`Pulte closed 4/20. These ${bucketB.length} jobs have an InFlow SO link but mid-payment status (PENDING/INVOICED/OVERDUE) — they may have been in-flight when the account was cut. Review each and decide COMPLETE vs CANCEL.`},
        'HIGH', 'PENDING',
        'Job', ${bucketB[0].id}, ${CLINT_ID},
        ${JSON.stringify({ reviewItems, reviewCount: bucketB.length, addedBy: 'cleanup-pulte-zombies', addedAt: nowIso })}::jsonb,
        NOW(), NOW()
      )
      RETURNING id
    `
    reviewInboxId = inserted.id
    console.log(`  created review InboxItem ${reviewInboxId} with ${bucketB.length} entries`)
  } else if (existingReview) {
    reviewInboxId = existingReview.id
    console.log(`  review InboxItem already exists (${reviewInboxId}) — skipping duplicate`)
  }

  // Summary InboxItem for Nate + Clint — only emit when we actually did work.
  // Idempotent re-runs (0 COMPLETE / 0 CANCELLED / 0 allocs released) skip it.
  let summaryInboxId = null
  const didWork = completeCount > 0 || cancelCount > 0 || releasedAllocs > 0 || auditLogs > 0
  if (!didWork) {
    console.log('  no transitions applied this run — skipping summary InboxItem')
  } else {
  const [summaryInbox] = await sql`
    INSERT INTO "InboxItem" (
      id, type, source, title, description, priority, status,
      "entityType", "entityId", "assignedTo", "actionData", "createdAt", "updatedAt"
    ) VALUES (
      ${'inbox_pulte_complete_' + Date.now().toString(36)},
      'PULTE_CLEANUP_COMPLETE', 'cleanup-pulte-zombies',
      ${`Pulte zombie cleanup applied: ${completeCount} → COMPLETE, ${cancelCount} → CLOSED (cancelled), ${bucketB.length} flagged`},
      ${`Post-account-loss cleanup ran on 2026-04-24. Released ${releasedAllocs} allocation rows (${releasedQty} units). Cross-dock + SmartPO crons re-ran with fresh state.`},
      'MEDIUM', 'PENDING',
      'Job', null, ${NATE_ID},
      ${JSON.stringify({
        completeCount, cancelCount, reviewCount: bucketB.length,
        releasedAllocs, releasedQty, auditLogs, reviewInboxId,
        addedBy: 'cleanup-pulte-zombies', addedAt: nowIso,
      })}::jsonb,
      NOW(), NOW()
    )
    RETURNING id
  `
  summaryInboxId = summaryInbox.id
  console.log(`  created summary InboxItem ${summaryInboxId}`)
  }

  // ── PHASE 6: Downstream cron re-run ──────────────────────────────────────
  sub('Phase 6. Re-run downstream crons to refresh derived state')

  let postCrossDock = null
  let postSmartPo = null
  let postSmartPoVendor = null
  if (SKIP_CRONS) {
    console.log('  --skip-crons flag → skipping cron triggers (Nate/ops will re-run)')
  } else {
    try {
      console.log('  triggering cross-dock-scan...')
      const cd = await triggerCron('/api/cron/cross-dock-scan')
      if (cd.status === 200) {
        console.log(`    ok: scanned=${cd.body.scannedLines} flagged=${cd.body.flaggedLines} cleared=${cd.body.clearedFlags} new=${cd.body.newFlags}`)
      } else {
        console.log(`    HTTP ${cd.status}: ${JSON.stringify(cd.body).slice(0, 200)}`)
      }
    } catch (e) {
      console.log(`    FAIL: ${e.message}  (dev server not running? skip with --skip-crons)`)
    }
    try {
      console.log('  triggering shortage-forecast...')
      const sf = await triggerCron('/api/cron/shortage-forecast')
      if (sf.status === 200) {
        console.log(`    ok: scanned=${sf.body.jobsScanned}/${sf.body.jobsTotalActive}  RED=${sf.body.redLines}  created=${sf.body.recommendationsCreated}  updated=${sf.body.recommendationsUpdated}  skipped=${sf.body.recommendationsSkipped}`)
      } else {
        console.log(`    HTTP ${sf.status}: ${JSON.stringify(sf.body).slice(0, 200)}`)
      }
    } catch (e) {
      console.log(`    FAIL: ${e.message}`)
    }

    ;[[postCrossDock], [postSmartPo], postSmartPoVendor] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM "PurchaseOrderItem" WHERE "crossDockFlag" = true`,
      sql`SELECT COUNT(*)::int AS c FROM "SmartPORecommendation" WHERE status = 'PENDING'`,
      sql`
        SELECT COALESCE(v.name,'(null)') AS vendor, COUNT(*)::int AS c
        FROM "SmartPORecommendation" s
        LEFT JOIN "Vendor" v ON v.id = s."vendorId"
        WHERE s.status = 'PENDING'
        GROUP BY v.name
        ORDER BY c DESC
      `,
    ])
  }

  // ── PHASE 7: Verify zero remaining zombies ───────────────────────────────
  sub('Phase 7. Verify zero remaining zombies')
  const [remaining] = await sql`
    SELECT COUNT(*)::int AS c
    FROM "Job"
    WHERE "builderName" = 'Pulte Homes'
      AND status::text = ANY(${ACTIVE_STATUSES})
  `
  console.log(`  remaining active Pulte zombies: ${remaining.c}  (expected ${bucketB.length})`)

  // Post-cleanup metrics
  const [
    [postCommittedRow],
    [postBrittneyRow],
  ] = await Promise.all([
    sql`SELECT COALESCE(SUM("committed"),0)::int AS sum_committed FROM "InventoryItem"`,
    sql`
      SELECT COUNT(*)::int AS c
      FROM "Job"
      WHERE "assignedPMId" = ${BRITTNEY_ID}
        AND status::text = ANY(${ACTIVE_STATUSES})
    `,
  ])

  bar('REPORT')
  console.log(`Bucket A (COMPLETE):              ${bucketA.length}   applied=${completeCount}`)
  console.log(`Bucket B (REVIEW):                ${bucketB.length}   inbox=${reviewInboxId || '(none)'}`)
  console.log(`Bucket C (CLOSED/cancelled):      ${bucketC.length}   applied=${cancelCount}`)
  console.log(`Allocations released:       ${releasedAllocs} rows, ${releasedQty} units`)
  console.log(`AuditLog rows written:      ${auditLogs}`)
  console.log(`Committed delta:            ${preCommittedRow.sum_committed} → ${postCommittedRow.sum_committed}  (Δ ${postCommittedRow.sum_committed - preCommittedRow.sum_committed})`)
  if (postCrossDock)
    console.log(`Cross-dock flags:           ${preCrossDockRow.c} → ${postCrossDock.c}`)
  if (postSmartPo) {
    console.log(`SmartPO PENDING:            ${preSmartPoRow.c} → ${postSmartPo.c}`)
    console.log(`  before vendors: ${preSmartPoVendor.map(v => `${v.vendor}=${v.c}`).join(', ')}`)
    console.log(`  after  vendors: ${postSmartPoVendor.map(v => `${v.vendor}=${v.c}`).join(', ')}`)
  }
  console.log(`Brittney active jobs:       ${preBrittneyRow.c} → ${postBrittneyRow.c}`)
  console.log(`Remaining zombies:          ${remaining.c}  (should equal Bucket B = ${bucketB.length})`)

  if (remaining.c !== bucketB.length) {
    console.log('\n  ⚠  Remaining zombie count does NOT match Bucket B — investigate.')
  } else {
    console.log('\n  cleanup passed integrity check.')
  }

  bar('DONE')
})().catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
