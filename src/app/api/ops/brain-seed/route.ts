export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

const CRON_SECRET = process.env.CRON_SECRET || 'not-set'

interface BrainKnowledgeEntry {
  category: 'customers' | 'products' | 'vendors' | 'staff' | 'inventory' | 'deals' | 'financial'
  title: string
  content: string
  tags?: string[]
  data: Record<string, any>
}

interface BrainSeedResponse {
  success: boolean
  category: string
  created: number
  updated: number
  failed: number
  errors: string[]
  totalProcessed: number
}

/**
 * POST /api/ops/brain-seed
 *
 * Accepts raw JSONL entries from the NUC brain and directly upserts them into Aegis
 * tables (Builder, Product, Vendor, Staff, InventoryItem, Deal, FinancialSnapshot).
 *
 * Request body: {
 *   entries: [ { category, title, content, tags, data }, ... ],
 *   category?: 'customers' | 'products' | ... (filter by category if provided)
 * }
 *
 * Requires: Authorization header with CRON_SECRET
 */
export async function POST(request: NextRequest) {
  try {
    // ─── AUTH CHECK ────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const entries: BrainKnowledgeEntry[] = body.entries || []
    const filterCategory: string | undefined = body.category

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: 'entries array is required and must not be empty' },
        { status: 400 }
      )
    }

    // Filter by category if provided
    const entriesToProcess = filterCategory
      ? entries.filter((e) => e.category === filterCategory)
      : entries

    // ─── AUDIT LOG ────────────────────────────────────────────────────
    audit(request, 'BRAIN_SEED', 'Database', undefined, {
      entriesCount: entriesToProcess.length,
      categories: [...new Set(entriesToProcess.map((e) => e.category))],
    }, 'CRITICAL')
      .catch(() => {})

    // ─── PROCESS BY CATEGORY ──────────────────────────────────────────
    const results: Record<string, BrainSeedResponse> = {}

    const categories = [...new Set(entriesToProcess.map((e) => e.category))]

    for (const category of categories) {
      const categoryEntries = entriesToProcess.filter((e) => e.category === category)
      console.log(`[brain-seed] Processing ${categoryEntries.length} ${category} entries`)

      try {
        const result = await processCategoryBatch(category, categoryEntries)
        results[category] = result
      } catch (error: any) {
        console.error(`[brain-seed] Error processing ${category}:`, error)
        results[category] = {
          success: false,
          category,
          created: 0,
          updated: 0,
          failed: categoryEntries.length,
          errors: [error?.message || 'Unknown error'],
          totalProcessed: 0,
        }
      }
    }

    // ─── AGGREGATE RESULTS ────────────────────────────────────────────
    const aggregated = {
      success: Object.values(results).every((r) => r.success),
      categories: results,
      totals: {
        created: Object.values(results).reduce((sum, r) => sum + r.created, 0),
        updated: Object.values(results).reduce((sum, r) => sum + r.updated, 0),
        failed: Object.values(results).reduce((sum, r) => sum + r.failed, 0),
        totalProcessed: entriesToProcess.length,
      },
    }

    return NextResponse.json(aggregated, { status: aggregated.success ? 200 : 206 })
  } catch (error: any) {
    console.error('[brain-seed] Fatal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Process a batch of entries for a single category.
 * Returns counts of created, updated, and failed records.
 */
async function processCategoryBatch(
  category: string,
  entries: BrainKnowledgeEntry[]
): Promise<BrainSeedResponse> {
  let created = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  // Process in batches of 50
  const batchSize = 50
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize)

    for (const entry of batch) {
      try {
        const result = await upsertByCategory(category, entry)
        if (result.type === 'created') created++
        else if (result.type === 'updated') updated++
      } catch (error: any) {
        failed++
        const msg = error?.message || 'Unknown error'
        if (errors.length < 10) errors.push(`${entry.title}: ${msg.substring(0, 80)}`)
      }
    }
  }

  return {
    success: failed === 0,
    category,
    created,
    updated,
    failed,
    errors,
    totalProcessed: entries.length,
  }
}

/**
 * Upsert a single entry into the appropriate Prisma table based on category.
 */
async function upsertByCategory(
  category: string,
  entry: BrainKnowledgeEntry
): Promise<{ type: 'created' | 'updated' }> {
  const { data } = entry

  switch (category) {
    case 'customers':
      return upsertBuilder(data)

    case 'products':
      return upsertProduct(data)

    case 'vendors':
      return upsertVendor(data)

    case 'staff':
      return upsertStaff(data)

    case 'inventory':
      return upsertInventoryItem(data)

    case 'deals':
      return upsertDeal(data)

    case 'financial':
      return upsertFinancialSnapshot(data)

    default:
      throw new Error(`Unknown category: ${category}`)
  }
}

// ─────────────────────────────────────────────────────────────────
// UPSERT FUNCTIONS BY CATEGORY
// ─────────────────────────────────────────────────────────────────

async function upsertBuilder(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const email = data.email || `unknown-${Date.now()}@abellumber.local`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "Builder" (
      "companyName", "contactName", "email", "passwordHash", "phone", "address",
      "city", "state", "zip", "builderType", "territory", "annualVolume", "website",
      "paymentTerm", "creditLimit", "accountBalance", "taxExempt", "taxId", "status",
      "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
    )
    ON CONFLICT ("email") DO UPDATE SET
      "companyName" = EXCLUDED."companyName",
      "contactName" = EXCLUDED."contactName",
      "phone" = EXCLUDED."phone",
      "address" = EXCLUDED."address",
      "city" = EXCLUDED."city",
      "state" = EXCLUDED."state",
      "zip" = EXCLUDED."zip",
      "territory" = EXCLUDED."territory",
      "annualVolume" = EXCLUDED."annualVolume",
      "website" = EXCLUDED."website",
      "creditLimit" = EXCLUDED."creditLimit",
      "updatedAt" = NOW()
    RETURNING id, "companyName", xmax`,
    data.name || data.companyName || 'Unknown',
    data.contact || data.contactName || 'TBD',
    email,
    '$2b$10$placeholder', // dummy hash
    data.phone || null,
    data.address || null,
    data.city || null,
    data.state || null,
    data.zip || null,
    data.builderType || 'CUSTOM',
    data.territory || null,
    data.annualVolume || null,
    data.website || null,
    data.paymentTerm || 'NET_15',
    data.creditLimit || null,
    0,
    false,
    data.taxId || null,
    data.status || 'ACTIVE',
    false
  )

  // xmax is Postgres' internal transaction ID for update detection
  // If xmax is 0 or null, it's a new insert; otherwise it was updated
  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertProduct(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const sku = data.sku || data.code || `SKU-${Date.now()}`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "Product" (
      "sku", "name", "displayName", "description", "category", "subcategory",
      "cost", "basePrice", "minMargin", "doorSize", "handing", "coreType",
      "panelStyle", "jambSize", "casingCode", "hardwareFinish", "material",
      "fireRating", "imageUrl", "thumbnailUrl", "imageAlt", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW()
    )
    ON CONFLICT ("sku") DO UPDATE SET
      "name" = EXCLUDED."name",
      "displayName" = EXCLUDED."displayName",
      "description" = EXCLUDED."description",
      "category" = EXCLUDED."category",
      "subcategory" = EXCLUDED."subcategory",
      "cost" = EXCLUDED."cost",
      "basePrice" = EXCLUDED."basePrice",
      "imageUrl" = EXCLUDED."imageUrl",
      "updatedAt" = NOW()
    RETURNING id, xmax`,
    sku,
    data.name || data.title || 'Unknown Product',
    data.displayName || null,
    data.description || null,
    data.category || 'Uncategorized',
    data.subcategory || null,
    parseFloat(data.cost) || 0,
    parseFloat(data.basePrice) || 0,
    parseFloat(data.minMargin) || 0.25,
    data.doorSize || null,
    data.handing || null,
    data.coreType || null,
    data.panelStyle || null,
    data.jambSize || null,
    data.casingCode || null,
    data.hardwareFinish || null,
    data.material || null,
    data.fireRating || null,
    data.imageUrl || null,
    data.thumbnailUrl || null,
    data.imageAlt || null
  )

  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertVendor(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const code = data.code || `VENDOR-${Date.now()}`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "Vendor" (
      "name", "code", "contactName", "email", "phone", "address", "website",
      "accountNumber", "avgLeadDays", "onTimeRate", "active", "inflowVendorId",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
    )
    ON CONFLICT ("code") DO UPDATE SET
      "name" = EXCLUDED."name",
      "contactName" = EXCLUDED."contactName",
      "email" = EXCLUDED."email",
      "phone" = EXCLUDED."phone",
      "address" = EXCLUDED."address",
      "website" = EXCLUDED."website",
      "avgLeadDays" = EXCLUDED."avgLeadDays",
      "onTimeRate" = EXCLUDED."onTimeRate",
      "updatedAt" = NOW()
    RETURNING id, xmax`,
    data.name || data.title || 'Unknown Vendor',
    code,
    data.contact || data.contactName || null,
    data.email || null,
    data.phone || null,
    data.address || null,
    data.website || null,
    data.accountNumber || null,
    data.avgLeadDays ? parseInt(data.avgLeadDays) : null,
    data.onTimeRate ? parseFloat(data.onTimeRate) : null,
    data.active !== false,
    data.inflowVendorId || null
  )

  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertStaff(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const email = data.email || `staff-${Date.now()}@abellumber.local`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "Staff" (
      "firstName", "lastName", "email", "passwordHash", "phone", "role", "department",
      "title", "avatar", "active", "hireDate", "managerId", "salary", "payType",
      "employmentType", "employeeId", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6::"StaffRole", $7::"Department", $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
    )
    ON CONFLICT ("email") DO UPDATE SET
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "phone" = EXCLUDED."phone",
      "role" = EXCLUDED."role",
      "department" = EXCLUDED."department",
      "title" = EXCLUDED."title",
      "salary" = EXCLUDED."salary",
      "updatedAt" = NOW()
    RETURNING id, xmax`,
    data.firstName || data.name?.split(' ')[0] || 'Unknown',
    data.lastName || data.name?.split(' ')[1] || 'Staff',
    email,
    '$2b$10$placeholder',
    data.phone || null,
    data.role || 'PROJECT_MANAGER',
    data.department || 'OPERATIONS',
    data.title || null,
    data.avatar || null,
    data.active !== false,
    data.hireDate ? new Date(data.hireDate) : null,
    data.managerId || null,
    data.salary ? parseFloat(data.salary) : null,
    data.payType || null,
    data.employmentType || null,
    data.employeeId || null
  )

  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertInventoryItem(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const productId = data.productId || `inv-${Date.now()}`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "InventoryItem" (
      "productId", "sku", "productName", "category", "onHand", "committed",
      "onOrder", "available", "reorderPoint", "reorderQty", "safetyStock",
      "maxStock", "unitCost", "avgDailyUsage", "daysOfSupply", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
    )
    ON CONFLICT ("productId") DO UPDATE SET
      "sku" = EXCLUDED."sku",
      "productName" = EXCLUDED."productName",
      "category" = EXCLUDED."category",
      "onHand" = EXCLUDED."onHand",
      "committed" = EXCLUDED."committed",
      "onOrder" = EXCLUDED."onOrder",
      "available" = EXCLUDED."available",
      "reorderPoint" = EXCLUDED."reorderPoint",
      "reorderQty" = EXCLUDED."reorderQty",
      "unitCost" = EXCLUDED."unitCost",
      "updatedAt" = NOW()
    RETURNING id, xmax`,
    productId,
    data.sku || null,
    data.productName || data.name || null,
    data.category || null,
    parseInt(data.onHand) || 0,
    parseInt(data.committed) || 0,
    parseInt(data.onOrder) || 0,
    parseInt(data.available) || 0,
    parseInt(data.reorderPoint) || 0,
    parseInt(data.reorderQty) || 0,
    parseInt(data.safetyStock) || 5,
    parseInt(data.maxStock) || 200,
    parseFloat(data.unitCost) || 0,
    parseFloat(data.avgDailyUsage) || 0,
    parseFloat(data.daysOfSupply) || 0
  )

  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertDeal(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  const dealNumber = data.dealNumber || `DEAL-${Date.now()}`

  const result = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "Deal" (
      "dealNumber", "companyName", "contactName", "contactEmail", "contactPhone",
      "address", "city", "state", "zip", "stage", "probability", "dealValue", "source",
      "expectedCloseDate", "actualCloseDate", "lostDate", "lostReason", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"DealStage", $11, $12, $13::"DealSource", $14, $15, $16, $17, NOW(), NOW()
    )
    ON CONFLICT ("dealNumber") DO UPDATE SET
      "companyName" = EXCLUDED."companyName",
      "contactName" = EXCLUDED."contactName",
      "stage" = EXCLUDED."stage",
      "probability" = EXCLUDED."probability",
      "dealValue" = EXCLUDED."dealValue",
      "expectedCloseDate" = EXCLUDED."expectedCloseDate",
      "updatedAt" = NOW()
    RETURNING id, xmax`,
    dealNumber,
    data.companyName || data.name || 'Unknown',
    data.contactName || null,
    data.contactEmail || null,
    data.contactPhone || null,
    data.address || null,
    data.city || null,
    data.state || null,
    data.zip || null,
    data.stage || 'PROSPECT',
    parseInt(data.probability) || 10,
    parseFloat(data.dealValue) || 0,
    data.source || 'OUTBOUND',
    data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
    data.actualCloseDate ? new Date(data.actualCloseDate) : null,
    data.lostDate ? new Date(data.lostDate) : null,
    data.lostReason || null
  )

  const isNew = !result[0]?.xmax || result[0]?.xmax === '0'
  return { type: isNew ? 'created' : 'updated' }
}

async function upsertFinancialSnapshot(
  data: Record<string, any>
): Promise<{ type: 'created' | 'updated' }> {
  // FinancialSnapshot is a time-series table, so we always insert new (no update)
  // unless the user wants to update a specific date snapshot
  const snapshotDate = data.snapshotDate ? new Date(data.snapshotDate) : new Date()

  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM "FinancialSnapshot" WHERE DATE("snapshotDate") = DATE($1)`,
    snapshotDate
  )

  if (existing.length > 0) {
    // Update existing snapshot for this date
    await prisma.$queryRawUnsafe(
      `UPDATE "FinancialSnapshot" SET
        "cashOnHand" = $1, "arTotal" = $2, "apTotal" = $3, "netCashPosition" = $4,
        "arCurrent" = $5, "ar30" = $6, "ar60" = $7, "ar90Plus" = $8,
        "dso" = $9, "dpo" = $10, "currentRatio" = $11,
        "revenueMonth" = $12, "revenuePrior" = $13, "revenueYTD" = $14,
        "updatedAt" = NOW()
       WHERE DATE("snapshotDate") = DATE($15)`,
      parseFloat(data.cashOnHand) || 0,
      parseFloat(data.arTotal) || 0,
      parseFloat(data.apTotal) || 0,
      parseFloat(data.netCashPosition) || 0,
      parseFloat(data.arCurrent) || 0,
      parseFloat(data.ar30) || 0,
      parseFloat(data.ar60) || 0,
      parseFloat(data.ar90Plus) || 0,
      parseFloat(data.dso) || 0,
      parseFloat(data.dpo) || 0,
      parseFloat(data.currentRatio) || 0,
      parseFloat(data.revenueMonth) || 0,
      parseFloat(data.revenuePrior) || 0,
      parseFloat(data.revenueYTD) || 0,
      snapshotDate
    )
    return { type: 'updated' }
  } else {
    // Insert new snapshot
    await prisma.$queryRawUnsafe(
      `INSERT INTO "FinancialSnapshot" (
        "snapshotDate", "cashOnHand", "arTotal", "apTotal", "netCashPosition",
        "arCurrent", "ar30", "ar60", "ar90Plus",
        "dso", "dpo", "currentRatio",
        "revenueMonth", "revenuePrior", "revenueYTD", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
      )`,
      snapshotDate,
      parseFloat(data.cashOnHand) || 0,
      parseFloat(data.arTotal) || 0,
      parseFloat(data.apTotal) || 0,
      parseFloat(data.netCashPosition) || 0,
      parseFloat(data.arCurrent) || 0,
      parseFloat(data.ar30) || 0,
      parseFloat(data.ar60) || 0,
      parseFloat(data.ar90Plus) || 0,
      parseFloat(data.dso) || 0,
      parseFloat(data.dpo) || 0,
      parseFloat(data.currentRatio) || 0,
      parseFloat(data.revenueMonth) || 0,
      parseFloat(data.revenuePrior) || 0,
      parseFloat(data.revenueYTD) || 0
    )
    return { type: 'created' }
  }
}
