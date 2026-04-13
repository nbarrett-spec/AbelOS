export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// POST /api/ops/data-fix — Run data cleanup and cross-linking tasks
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'crosslink-bolt-jobs':
        return await crosslinkBoltWorkOrdersToJobs()
      case 'fix-staff-roles':
        return await fixStaffRoles(body)
      case 'advance-orders':
        return await advanceOrderPipeline(body)
      case 'status-report':
        return await getStatusReport()
      case 'audit-order-assignments':
        return await auditOrderAssignments()
      case 'fix-order-assignments':
        return await fixOrderAssignments(body)
      case 'delete-test-records':
        return await deleteTestRecords()
      case 'clean-inflow-orders':
        return await cleanInflowOrders(body)
      case 'run-query':
        return await runQuery(body)
      case 'run-update':
        return await runUpdate(body)
      case 'bulk-import-hp':
        return await bulkImportHyphenPayments(body)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('Data fix error:', error)
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 })
  }
}

// Cross-link BoltWorkOrders to Jobs using community + address/lot matching
async function crosslinkBoltWorkOrdersToJobs() {
  const results: any = { matched: 0, unmatched: 0, scheduleDatesSet: 0, details: [] }

  // Get all Bolt work orders — columns: id, boltId, jobAddress, woType, scheduledDate, stage, assignedTo, orderedBy
  const boltWOs: any[] = await prisma.$queryRawUnsafe(`
    SELECT bw.id, bw."boltId", bw."jobAddress", bw."woType", bw."scheduledDate",
      bw."stage", bw."assignedTo"
    FROM "BoltWorkOrder" bw
    ORDER BY bw."scheduledDate" DESC NULLS LAST
  `)

  // Get all Jobs — columns: id, jobNumber, community, lotBlock, jobAddress, status, scheduledDate
  const jobs: any[] = await prisma.$queryRawUnsafe(`
    SELECT j.id, j."jobNumber", j.community, j."lotBlock", j."jobAddress", j.status::text as status,
      j."scheduledDate", j."createdAt"
    FROM "Job" j
  `)

  // Strategy: match by jobAddress and community overlap
  let matched = 0
  let scheduleDatesSet = 0

  for (const wo of boltWOs) {
    if (!wo.jobAddress) continue
    const woAddr = wo.jobAddress.toLowerCase().trim()

    // Try to find matching job
    let bestMatch = null
    let bestScore = 0

    for (const job of jobs) {
      let score = 0

      // Bolt jobAddress often contains "CommunityName - LotInfo" or full address
      // Try matching community name within jobAddress
      if (job.community) {
        const jobCommunity = job.community.toLowerCase().trim()
        if (woAddr.includes(jobCommunity)) score += 3
        if (woAddr === jobCommunity) score += 2  // exact = bonus
      }

      // Job jobAddress match
      if (job.jobAddress) {
        const jobAddr = job.jobAddress.toLowerCase().trim()
        if (woAddr === jobAddr) score += 5
        else if (woAddr.includes(jobAddr) || jobAddr.includes(woAddr)) score += 3
      }

      // Lot block in jobAddress
      if (job.lotBlock) {
        const lotStr = job.lotBlock.toLowerCase().trim()
        if (lotStr && woAddr.includes(lotStr)) score += 2
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = job
      }
    }

    if (bestMatch && bestScore >= 5) {
      matched++

      // Update BoltWorkOrder with jobId link
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "BoltWorkOrder" ADD COLUMN IF NOT EXISTS "jobId" TEXT
        `)
        await prisma.$executeRawUnsafe(`
          UPDATE "BoltWorkOrder" SET "jobId" = $1 WHERE id = $2
        `, bestMatch.id, wo.id)
      } catch (e: any) { console.warn('[DataFix] Failed to link BoltWorkOrder→Job:', wo.id, e?.message) }

      // Set scheduledDate on Job if we have one from Bolt and Job doesn't have one
      if (wo.scheduledDate && !bestMatch.scheduledDate) {
        try {
          await prisma.$executeRawUnsafe(`
            UPDATE "Job" SET "scheduledDate" = $1::timestamptz WHERE id = $2
          `, wo.scheduledDate, bestMatch.id)
          scheduleDatesSet++
        } catch (e: any) { console.warn('[DataFix] Failed to set Job scheduledDate:', bestMatch.id, e?.message) }
      }
    }
  }

  results.matched = matched
  results.unmatched = boltWOs.length - matched
  results.scheduleDatesSet = scheduleDatesSet
  results.totalBoltWOs = boltWOs.length
  results.totalJobs = jobs.length

  return NextResponse.json({ success: true, action: 'crosslink-bolt-jobs', results })
}

// Fix staff roles — update VIEWER roles to proper assignments
async function fixStaffRoles(body: any) {
  const { assignments } = body
  // assignments: [{ staffId, role }]

  if (!assignments || !Array.isArray(assignments)) {
    // Return current VIEWER staff for the user to decide
    const viewers: any[] = await prisma.$queryRawUnsafe(`
      SELECT s.id, s."firstName", s."lastName", s.email, s.department,
        sr.role
      FROM "Staff" s
      LEFT JOIN "StaffRoles" sr ON s.id = sr."staffId"
      WHERE sr.role = 'VIEWER' OR sr.role IS NULL
      ORDER BY s."lastName"
    `)
    return NextResponse.json({ action: 'fix-staff-roles', viewers, message: 'Provide assignments array to update roles' })
  }

  let updated = 0
  for (const { staffId, role } of assignments) {
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE "StaffRoles" SET role = $1::"StaffRole" WHERE "staffId" = $2 AND role = 'VIEWER'::"StaffRole"
      `, role, staffId)
      updated++
    } catch (e) {
      // Try insert if no existing row
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "StaffRoles" (id, "staffId", role, "createdAt")
          VALUES (gen_random_uuid()::text, $1, $2::"StaffRole", NOW())
          ON CONFLICT DO NOTHING
        `, staffId, role)
        updated++
      } catch (e2: any) { console.warn('[Data Fix] Failed to insert new staff role:', e2?.message) }
    }
  }

  return NextResponse.json({ success: true, action: 'fix-staff-roles', updated })
}

// Advance order pipeline — move orders from RECEIVED to appropriate statuses
async function advanceOrderPipeline(body: any) {
  const { dryRun = true } = body

  // Get order status distribution
  const statuses: any[] = await prisma.$queryRawUnsafe(`
    SELECT status::text, COUNT(*)::int as count
    FROM "Order"
    GROUP BY status
    ORDER BY count DESC
  `)

  // Get RECEIVED orders with enough info to auto-advance
  const receivedOrders: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status::text as status, o.total, o."createdAt",
      b."companyName",
      EXTRACT(DAY FROM (NOW() - o."createdAt"))::int as "daysOld"
    FROM "Order" o
    JOIN "Builder" b ON o."builderId" = b.id
    WHERE o.status = 'RECEIVED'::"OrderStatus"
    ORDER BY o."createdAt" ASC
    LIMIT 50
  `)

  if (!dryRun) {
    // Auto-confirm orders older than 3 days (assume confirmed via Bolt)
    const confirmed = await prisma.$executeRawUnsafe(`
      UPDATE "Order"
      SET status = 'CONFIRMED'::"OrderStatus", "updatedAt" = NOW()
      WHERE status = 'RECEIVED'::"OrderStatus"
        AND "createdAt" < NOW() - INTERVAL '3 days'
    `)

    return NextResponse.json({
      success: true,
      action: 'advance-orders',
      dryRun: false,
      confirmedCount: confirmed,
      statusesBefore: statuses,
    })
  }

  // Dry run: show what would change
  const wouldConfirm: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as count
    FROM "Order"
    WHERE status = 'RECEIVED'::"OrderStatus"
      AND "createdAt" < NOW() - INTERVAL '3 days'
  `)

  return NextResponse.json({
    action: 'advance-orders',
    dryRun: true,
    currentStatuses: statuses,
    wouldConfirm: wouldConfirm[0]?.count || 0,
    sampleReceived: receivedOrders.slice(0, 10),
    message: 'Set dryRun: false to execute',
  })
}

// Get a quick status report of data health
async function getStatusReport() {
  const counts: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "Order") as orders,
      (SELECT COUNT(*)::int FROM "Job") as jobs,
      (SELECT COUNT(*)::int FROM "Builder") as builders,
      (SELECT COUNT(*)::int FROM "Staff") as staff,
      (SELECT COUNT(*)::int FROM "Invoice") as invoices,
      (SELECT COUNT(*)::int FROM "Payment") as payments,
      (SELECT COUNT(*)::int FROM "PurchaseOrder") as "purchaseOrders",
      (SELECT COUNT(*)::int FROM "Vendor") as vendors,
      (SELECT COUNT(*)::int FROM "BoltWorkOrder") as "boltWorkOrders",
      (SELECT COUNT(*)::int FROM "BoltCommunity") as "boltCommunities",
      (SELECT COUNT(*)::int FROM "Product") as products,
      (SELECT COUNT(*)::int FROM "InventoryItem") as "inventoryItems",
      (SELECT COUNT(*)::int FROM "BuilderPricing") as "builderPricingEntries",
      (SELECT COUNT(*)::int FROM "VendorProduct") as "vendorProducts",
      (SELECT COUNT(*)::int FROM "BomEntry") as "bomEntries"
  `)

  const orderStatuses: any[] = await prisma.$queryRawUnsafe(`
    SELECT status::text, COUNT(*)::int as count FROM "Order" GROUP BY status ORDER BY count DESC
  `)

  const jobStatuses: any[] = await prisma.$queryRawUnsafe(`
    SELECT status::text, COUNT(*)::int as count FROM "Job" GROUP BY status ORDER BY count DESC
  `)

  const staffRoles: any[] = await prisma.$queryRawUnsafe(`
    SELECT sr.role::text, COUNT(*)::int as count
    FROM "StaffRoles" sr GROUP BY sr.role ORDER BY count DESC
  `)

  return NextResponse.json({
    action: 'status-report',
    counts: counts[0],
    orderStatuses,
    jobStatuses,
    staffRoles,
  })
}

// Audit order assignments — find orders potentially misassigned via default builder fallback
async function auditOrderAssignments() {
  // 1. Identify the "default builder" (same logic as inflow sync: LIMIT 1)
  const defaultBuilder: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "companyName" FROM "Builder" LIMIT 1`
  )
  const defaultBuilderId = defaultBuilder[0]?.id
  const defaultBuilderName = defaultBuilder[0]?.companyName

  // 2. Get all orders assigned to this default builder
  const defaultBuilderOrders: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.total::float8 as total, o.status::text as status,
      o."inflowOrderId", o."inflowCustomerId", o."createdAt"
    FROM "Order" o
    WHERE o."builderId" = $1
    ORDER BY o.total DESC
  `, defaultBuilderId)

  // 3. Group by inflowCustomerId to see how many distinct InFlow customers were lumped in
  const customerGroups: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(o."inflowCustomerId", 'NO_INFLOW_ID') as "inflowCustomerId",
      COUNT(*)::int as "orderCount",
      COALESCE(SUM(o.total)::float8, 0) as "totalValue"
    FROM "Order" o
    WHERE o."builderId" = $1
    GROUP BY o."inflowCustomerId"
    ORDER BY "totalValue" DESC
  `, defaultBuilderId)

  // 4. Get the actual top builders for comparison (excluding the default builder)
  const topBuildersExcluding: any[] = await prisma.$queryRawUnsafe(`
    SELECT b."companyName", COUNT(*)::int as "orderCount",
      COALESCE(SUM(o.total)::float8, 0) as "totalValue"
    FROM "Order" o
    JOIN "Builder" b ON o."builderId" = b.id
    WHERE o."builderId" != $1 AND o.status::text != 'CANCELLED'
    GROUP BY b."companyName"
    ORDER BY "totalValue" DESC
    LIMIT 10
  `, defaultBuilderId)

  // 5. Check how many orders have inflowCustomerId that DON'T match any builder
  const unmatchedCustomerIds: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT o."inflowCustomerId"
    FROM "Order" o
    WHERE o."builderId" = $1
      AND o."inflowCustomerId" IS NOT NULL
      AND o."inflowCustomerId" NOT IN (
        SELECT DISTINCT o2."inflowCustomerId" FROM "Order" o2
        WHERE o2."builderId" != $1 AND o2."inflowCustomerId" IS NOT NULL
      )
  `, defaultBuilderId)

  return NextResponse.json({
    action: 'audit-order-assignments',
    defaultBuilder: { id: defaultBuilderId, name: defaultBuilderName },
    defaultBuilderOrderCount: defaultBuilderOrders.length,
    defaultBuilderTotalRevenue: defaultBuilderOrders.reduce((s: number, o: any) => s + (o.total || 0), 0),
    customerGroupsOnDefaultBuilder: customerGroups,
    unmatchedInflowCustomerIds: unmatchedCustomerIds.map((r: any) => r.inflowCustomerId),
    topBuildersExcludingDefault: topBuildersExcluding,
    sampleOrders: defaultBuilderOrders.slice(0, 20),
  })
}

// Fix order assignments — create new builders for unmatched InFlow customers and reassign orders
async function fixOrderAssignments(body: any) {
  const { dryRun = true } = body

  // Get the default builder
  const defaultBuilder: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "companyName" FROM "Builder" LIMIT 1`
  )
  const defaultBuilderId = defaultBuilder[0]?.id
  const defaultBuilderName = defaultBuilder[0]?.companyName

  // Find orders on default builder grouped by inflowCustomerId
  const customerGroups: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(o."inflowCustomerId", 'NO_INFLOW_ID') as "inflowCustomerId",
      COUNT(*)::int as "orderCount",
      COALESCE(SUM(o.total)::float8, 0) as "totalValue",
      MIN(o."orderNumber") as "sampleOrder"
    FROM "Order" o
    WHERE o."builderId" = $1
    GROUP BY o."inflowCustomerId"
    ORDER BY "totalValue" DESC
  `, defaultBuilderId)

  // Separate: orders that truly belong to the default builder vs. misassigned
  // If the order has NO inflowCustomerId, it was likely created manually or via CSV — keep it
  // If the order HAS an inflowCustomerId, check if that customer ID maps to any other builder
  const results = {
    defaultBuilder: defaultBuilderName,
    keptOnDefault: 0,
    keptRevenue: 0,
    reassigned: 0,
    reassignedRevenue: 0,
    newBuildersCreated: 0,
    movedToUnknown: 0,
    movedToUnknownRevenue: 0,
    details: [] as any[],
  }

  if (dryRun) {
    // Just report what would happen
    for (const group of customerGroups) {
      if (group.inflowCustomerId === 'NO_INFLOW_ID') {
        results.keptOnDefault += group.orderCount
        results.keptRevenue += group.totalValue
        results.details.push({
          inflowCustomerId: null,
          action: 'KEEP — no InFlow ID, likely legitimate',
          orderCount: group.orderCount,
          totalValue: group.totalValue,
        })
      } else {
        results.movedToUnknown += group.orderCount
        results.movedToUnknownRevenue += group.totalValue
        results.details.push({
          inflowCustomerId: group.inflowCustomerId,
          action: 'REASSIGN — create "Unknown InFlow Customer" builder or match to real customer',
          orderCount: group.orderCount,
          totalValue: group.totalValue,
          sampleOrder: group.sampleOrder,
        })
      }
    }

    return NextResponse.json({
      action: 'fix-order-assignments',
      dryRun: true,
      results,
      message: 'Set dryRun: false to execute. Orders with inflowCustomerId that do not belong to default builder will be reassigned to an "Unmatched InFlow Customers" builder.',
    })
  }

  // EXECUTE: Create a catch-all builder for unmatched InFlow customers, then reassign
  // First create or find the unmatched builder
  const unmatchedBuilder: any[] = await prisma.$queryRawUnsafe(`
    SELECT id FROM "Builder" WHERE "companyName" = 'Unmatched InFlow Customers' LIMIT 1
  `)

  let unmatchedBuilderId: string
  if (unmatchedBuilder.length > 0) {
    unmatchedBuilderId = unmatchedBuilder[0].id
  } else {
    const created: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO "Builder" (id, "companyName", "contactName", email, "passwordHash", phone, status, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'Unmatched InFlow Customers', 'Data Cleanup', 'datafix@abellumber.com', 'NOLOGIN', '', 'ACTIVE'::"AccountStatus", NOW(), NOW())
      RETURNING id
    `)
    unmatchedBuilderId = created[0].id
    results.newBuildersCreated = 1
  }

  // Reassign orders that have an inflowCustomerId but are on the default builder
  for (const group of customerGroups) {
    if (group.inflowCustomerId === 'NO_INFLOW_ID') {
      results.keptOnDefault += group.orderCount
      results.keptRevenue += group.totalValue
      continue
    }

    // Move these orders to the unmatched builder
    await prisma.$executeRawUnsafe(`
      UPDATE "Order" SET "builderId" = $1, "updatedAt" = NOW()
      WHERE "builderId" = $2 AND "inflowCustomerId" = $3
    `, unmatchedBuilderId, defaultBuilderId, group.inflowCustomerId)

    results.reassigned += group.orderCount
    results.reassignedRevenue += group.totalValue
    results.details.push({
      inflowCustomerId: group.inflowCustomerId,
      action: 'REASSIGNED to Unmatched InFlow Customers',
      orderCount: group.orderCount,
      totalValue: group.totalValue,
    })
  }

  return NextResponse.json({
    action: 'fix-order-assignments',
    dryRun: false,
    results,
    message: `Reassigned ${results.reassigned} orders ($${results.reassignedRevenue.toFixed(2)}) from "${defaultBuilderName}" to "Unmatched InFlow Customers". ${results.keptOnDefault} orders kept on ${defaultBuilderName} (no InFlow ID — likely legitimate).`,
  })
}

// Clean up InFlow-imported orders: fix statuses and dates based on InFlow data
async function cleanInflowOrders(body: any) {
  const { dryRun = true } = body

  // Step 1: Get current order status breakdown
  const statusesBefore: any[] = await prisma.$queryRawUnsafe(`
    SELECT status::text, COUNT(*)::int as count FROM "Order" GROUP BY status ORDER BY count DESC
  `)

  // Step 2: Orders imported from InFlow that are stuck in RECEIVED but are old (>30 days)
  // These should be COMPLETE — InFlow Fulfilled/Invoiced orders are done
  const staleReceived: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status::text as status, o."paymentStatus"::text as "paymentStatus",
      o."createdAt", o."inflowOrderId",
      EXTRACT(DAY FROM (NOW() - o."createdAt"))::int as "daysOld",
      b."companyName"
    FROM "Order" o
    JOIN "Builder" b ON o."builderId" = b.id
    WHERE o.status = 'RECEIVED'::"OrderStatus"
      AND o."createdAt" < NOW() - INTERVAL '30 days'
    ORDER BY o."createdAt" ASC
  `)

  // Step 3: Also get CONFIRMED, IN_PRODUCTION, DELIVERED orders that are old and should be COMPLETE
  const staleInProgress: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status::text as status, o."paymentStatus"::text as "paymentStatus",
      o."createdAt",
      EXTRACT(DAY FROM (NOW() - o."createdAt"))::int as "daysOld",
      b."companyName"
    FROM "Order" o
    JOIN "Builder" b ON o."builderId" = b.id
    WHERE o.status IN ('CONFIRMED'::"OrderStatus", 'IN_PRODUCTION'::"OrderStatus", 'DELIVERED'::"OrderStatus")
      AND o."createdAt" < NOW() - INTERVAL '90 days'
    ORDER BY o."createdAt" ASC
  `)

  // Step 4: Fix payment statuses — orders with paidAt set should be PAID, not PENDING
  const wrongPayment: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o."paymentStatus"::text as "paymentStatus", o."paidAt"
    FROM "Order" o
    WHERE o."paidAt" IS NOT NULL AND o."paymentStatus" != 'PAID'::"PaymentStatus"
  `)

  if (dryRun) {
    return NextResponse.json({
      action: 'clean-inflow-orders',
      dryRun: true,
      statusesBefore,
      staleReceivedCount: staleReceived.length,
      staleReceivedSample: staleReceived.slice(0, 10),
      staleInProgressCount: staleInProgress.length,
      staleInProgressSample: staleInProgress.slice(0, 10),
      wrongPaymentCount: wrongPayment.length,
      plan: {
        step1: `${staleReceived.length} orders RECEIVED >30 days → COMPLETE`,
        step2: `${staleInProgress.length} orders CONFIRMED/IN_PRODUCTION/DELIVERED >90 days → COMPLETE`,
        step3: `${wrongPayment.length} orders with paidAt but wrong paymentStatus → PAID`,
      },
      message: 'Set dryRun: false to execute all fixes',
    })
  }

  // EXECUTE fixes
  let completedFromReceived = 0
  let completedFromInProgress = 0
  let paymentFixed = 0

  // Fix 1: RECEIVED > 30 days → COMPLETE
  const fix1 = await prisma.$executeRawUnsafe(`
    UPDATE "Order"
    SET status = 'COMPLETE'::"OrderStatus",
        "paymentStatus" = CASE
          WHEN "paidAt" IS NOT NULL THEN 'PAID'::"PaymentStatus"
          WHEN "paymentStatus" = 'PENDING'::"PaymentStatus" THEN 'INVOICED'::"PaymentStatus"
          ELSE "paymentStatus"
        END,
        "updatedAt" = NOW()
    WHERE status = 'RECEIVED'::"OrderStatus"
      AND "createdAt" < NOW() - INTERVAL '30 days'
  `)
  completedFromReceived = fix1 as number

  // Fix 2: CONFIRMED/IN_PRODUCTION/DELIVERED > 90 days → COMPLETE
  const fix2 = await prisma.$executeRawUnsafe(`
    UPDATE "Order"
    SET status = 'COMPLETE'::"OrderStatus",
        "paymentStatus" = CASE
          WHEN "paidAt" IS NOT NULL THEN 'PAID'::"PaymentStatus"
          WHEN "paymentStatus" = 'PENDING'::"PaymentStatus" THEN 'INVOICED'::"PaymentStatus"
          ELSE "paymentStatus"
        END,
        "updatedAt" = NOW()
    WHERE status IN ('CONFIRMED'::"OrderStatus", 'IN_PRODUCTION'::"OrderStatus", 'DELIVERED'::"OrderStatus")
      AND "createdAt" < NOW() - INTERVAL '90 days'
  `)
  completedFromInProgress = fix2 as number

  // Fix 3: Payment status where paidAt exists
  const fix3 = await prisma.$executeRawUnsafe(`
    UPDATE "Order"
    SET "paymentStatus" = 'PAID'::"PaymentStatus", "updatedAt" = NOW()
    WHERE "paidAt" IS NOT NULL AND "paymentStatus" != 'PAID'::"PaymentStatus"
  `)
  paymentFixed = fix3 as number

  // Get updated status breakdown
  const statusesAfter: any[] = await prisma.$queryRawUnsafe(`
    SELECT status::text, COUNT(*)::int as count FROM "Order" GROUP BY status ORDER BY count DESC
  `)

  return NextResponse.json({
    action: 'clean-inflow-orders',
    dryRun: false,
    completedFromReceived,
    completedFromInProgress,
    paymentFixed,
    totalFixed: completedFromReceived + completedFromInProgress,
    statusesBefore,
    statusesAfter,
    message: `Cleaned up ${completedFromReceived + completedFromInProgress} stale orders → COMPLETE. Fixed ${paymentFixed} payment statuses.`,
  })
}

// Delete test records
async function deleteTestRecords() {
  const results: any = { deleted: [] }

  // Delete BoltWorkOrder with boltId "COUNT_CHECK"
  const countCheck = await prisma.$executeRawUnsafe(
    `DELETE FROM "BoltWorkOrder" WHERE "boltId" = 'COUNT_CHECK'`
  )
  results.deleted.push({ table: 'BoltWorkOrder', boltId: 'COUNT_CHECK', affected: countCheck })

  return NextResponse.json({ action: 'delete-test-records', results })
}

// Run an arbitrary SELECT query (read-only) for data auditing
async function runQuery(body: any) {
  const { query } = body
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }
  const trimmed = query.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT')) {
    return NextResponse.json({ error: 'Only SELECT queries allowed' }, { status: 400 })
  }
  const rows: any[] = await prisma.$queryRawUnsafe(query)
  return NextResponse.json({ action: 'run-query', rowCount: rows.length, rows })
}

// Run an UPDATE/INSERT/DELETE query for data fixes
async function runUpdate(body: any) {
  const { query } = body
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }
  const trimmed = query.trim().toUpperCase()
  if (trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE') || trimmed.startsWith('ALTER')) {
    return NextResponse.json({ error: 'DDL not allowed' }, { status: 400 })
  }
  const affected = await prisma.$executeRawUnsafe(query)
  return NextResponse.json({ action: 'run-update', affected })
}

// Bulk import HyphenPayment rows from clean JSON array
async function bulkImportHyphenPayments(body: any) {
  const { payments, clearFirst } = body
  if (!payments || !Array.isArray(payments)) {
    return NextResponse.json({ error: 'payments array is required' }, { status: 400 })
  }

  let deleted = 0
  if (clearFirst) {
    deleted = await prisma.$executeRawUnsafe(`DELETE FROM "HyphenPayment"`)
  }

  // Insert in batches of 50 rows using multi-row VALUES
  const batchSize = 50
  let totalInserted = 0
  const errors: string[] = []

  for (let i = 0; i < payments.length; i += batchSize) {
    const batch = payments.slice(i, i + batchSize)
    const values = batch.map((p: any) => {
      const esc = (s: string) => (s || '').replace(/'/g, "''")
      return `(gen_random_uuid()::text, '${esc(p.builderAccount)}', '${esc(p.builderName)}', '${esc(p.orderNumber)}', '${esc(p.address)}', '${esc(p.subdivision)}', '${esc(p.lotBlockPlan)}', '${esc(p.supplierOrderNum)}', '${esc(p.taskDescription)}', '${esc(p.soNumber)}', '${esc(p.invoiceNumber)}', '${esc(p.checkNumber)}', '${p.paymentDate}', ${p.amount}, '${esc(p.paymentType)}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    }).join(',\n')

    const sql = `INSERT INTO "HyphenPayment" ("id", "builderAccount", "builderName", "orderNumber", "address", "subdivision", "lotBlockPlan", "supplierOrderNum", "taskDescription", "soNumber", "invoiceNumber", "checkNumber", "paymentDate", "amount", "paymentType", "createdAt", "updatedAt") VALUES ${values}`

    try {
      const affected = await prisma.$executeRawUnsafe(sql)
      totalInserted += affected
    } catch (err: any) {
      errors.push(`Batch ${i / batchSize}: ${err.message?.slice(0, 200)}`)
    }
  }

  return NextResponse.json({
    action: 'bulk-import-hp',
    deleted,
    totalInserted,
    totalPayments: payments.length,
    batches: Math.ceil(payments.length / batchSize),
    errors: errors.length > 0 ? errors : undefined
  })
}
