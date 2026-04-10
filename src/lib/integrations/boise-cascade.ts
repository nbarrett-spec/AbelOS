// ──────────────────────────────────────────────────────────────────────────
// Boise Cascade / BlueLinx Supplier Pricing Integration
// ──────────────────────────────────────────────────────────────────────────
// Handles CSV price sheet uploads from Boise Cascade, matches SKUs to Abel
// products, calculates margin impact, and stores changes for review/approval.

import { prisma } from '@/lib/prisma'

export interface BoiseCascadePriceRow {
  itemNumber?: string
  supplierSku?: string
  description?: string
  uom?: string
  listPrice?: number
  netPrice?: number
  cost?: number
  effectiveDate?: string
  [key: string]: any
}

export interface SKUMatchResult {
  productId: string
  productName: string
  productSku: string
  matchType: 'exact' | 'partial' | 'fuzzy'
  confidence: number // 0-1
  supplierSku: string
  supplierProductName: string
}

export interface PriceChangeResult {
  productId: string
  productName: string
  supplierSku: string
  previousCost: number
  newCost: number
  costChange: number
  costChangePct: number
  currentPrice: number
  suggestedPrice: number
  currentMarginPct: number
  newMarginPct: number
  marginBelowThreshold: boolean
  minMargin: number
}

export interface SupplierPriceUpdateRecord {
  id?: string
  supplier: string
  batchId: string
  productId: string
  supplierSku: string
  productName: string
  previousCost: number
  newCost: number
  costChange: number
  costChangePct: number
  currentPrice: number
  suggestedPrice: number
  currentMarginPct: number
  newMarginPct: number
  status: string // PENDING, APPROVED, REJECTED
  matchType?: string
  matchConfidence?: number
  appliedAt?: Date
  appliedById?: string
}

export interface BatchImportResult {
  batchId: string
  supplier: string
  totalRows: number
  matchedProducts: number
  unmatchedRows: number
  matchedUpdates: SupplierPriceUpdateRecord[]
  unmatchedItems: Array<{
    supplierSku: string
    supplierProductName: string
    reason: string
  }>
}

// ──────────────────────────────────────────────────────────────────────────
// CSV Parser — Handle common Boise Cascade price sheet formats
// ──────────────────────────────────────────────────────────────────────────

export function parseCSV(csvContent: string): BoiseCascadePriceRow[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return []

  // Detect header row (case-insensitive)
  const headerLine = lines[0]
  const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase())

  // Map common Boise Cascade column names
  const columnMap: Record<string, string[]> = {
    supplierSku: ['item number', 'itemnumber', 'item #', 'sku', 'item', 'product code'],
    description: ['description', 'product name', 'product', 'name'],
    uom: ['uom', 'unit of measure', 'unit', 'measure'],
    listPrice: ['list price', 'list', 'msrp'],
    netPrice: ['net price', 'net', 'dealer price', 'our price'],
    cost: ['cost', 'unit cost', 'your cost', 'our cost', 'wholesale'],
    effectiveDate: ['effective date', 'effective', 'date', 'as of']
  }

  // Find column indices
  const columnIndices: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(columnMap)) {
    for (let i = 0; i < headers.length; i++) {
      if (aliases.some(alias => headers[i].includes(alias))) {
        columnIndices[key] = i
        break
      }
    }
  }

  // Parse data rows
  const rows: BoiseCascadePriceRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row: BoiseCascadePriceRow = {}

    for (const [key, colIndex] of Object.entries(columnIndices)) {
      const value = values[colIndex]?.trim()
      if (!value) continue

      if (key === 'listPrice' || key === 'netPrice' || key === 'cost') {
        // Parse as float, handle $ and commas
        row[key] = parseFloat(value.replace(/[$,]/g, ''))
        if (isNaN(row[key])) delete row[key]
      } else {
        row[key] = value
      }
    }

    if (row.supplierSku || row.description) {
      rows.push(row)
    }
  }

  return rows
}

// Parse CSV line, handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// SKU Matching Engine
// ──────────────────────────────────────────────────────────────────────────

export async function matchSKU(
  supplierSku: string,
  supplierProductName: string
): Promise<SKUMatchResult | null> {
  if (!supplierSku && !supplierProductName) return null

  try {
    // 1. Try exact SKU match
    const exactMatch: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, sku, name FROM "Product" WHERE LOWER(sku) = LOWER($1) AND active = true LIMIT 1`,
      supplierSku
    )

    if (exactMatch.length > 0) {
      return {
        productId: exactMatch[0].id,
        productName: exactMatch[0].name,
        productSku: exactMatch[0].sku,
        matchType: 'exact',
        confidence: 1.0,
        supplierSku,
        supplierProductName
      }
    }

    // 2. Try fuzzy name match on description
    if (supplierProductName) {
      const nameSearchTerms = supplierProductName.toLowerCase().split(/\s+/).slice(0, 4)
      const searchPattern = nameSearchTerms.join(' & ')

      const fuzzyMatches: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, sku, name,
          SIMILARITY(LOWER(name), LOWER($1)) as similarity
         FROM "Product"
         WHERE active = true AND SIMILARITY(LOWER(name), LOWER($1)) > 0.3
         ORDER BY similarity DESC
         LIMIT 5`,
        supplierProductName
      )

      if (fuzzyMatches.length > 0 && fuzzyMatches[0].similarity > 0.5) {
        const topMatch = fuzzyMatches[0]
        return {
          productId: topMatch.id,
          productName: topMatch.name,
          productSku: topMatch.sku,
          matchType: 'fuzzy',
          confidence: Math.min(topMatch.similarity, 0.95),
          supplierSku,
          supplierProductName
        }
      }
    }

    // 3. Try partial word match
    if (supplierProductName) {
      const words = supplierProductName.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      if (words.length > 0) {
        const searchTerm = words[0]
        const partialMatches: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, sku, name FROM "Product"
           WHERE active = true AND LOWER(name) LIKE $1
           LIMIT 3`,
          `%${searchTerm}%`
        )

        if (partialMatches.length > 0) {
          return {
            productId: partialMatches[0].id,
            productName: partialMatches[0].name,
            productSku: partialMatches[0].sku,
            matchType: 'partial',
            confidence: 0.4,
            supplierSku,
            supplierProductName
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('Error matching SKU:', error)
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Price Change Calculator
// ──────────────────────────────────────────────────────────────────────────

export async function calculatePriceChange(
  productId: string,
  newCost: number
): Promise<PriceChangeResult | null> {
  try {
    const product: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, sku, cost, "basePrice", "minMargin" FROM "Product" WHERE id = $1`,
      productId
    )

    if (product.length === 0) return null

    const p = product[0]
    const previousCost = p.cost
    const costChange = newCost - previousCost
    const costChangePct = previousCost > 0 ? (costChange / previousCost) * 100 : 0
    const currentPrice = p.basePrice
    const currentMarginPct = previousCost > 0 ? ((currentPrice - previousCost) / currentPrice) * 100 : 0

    // If cost increases, price should increase proportionally to maintain margin
    // If cost decreases, we can keep the same price or pass savings to customer
    const marginDifference = currentMarginPct - (p.minMargin * 100)
    let suggestedPrice = currentPrice

    // If new cost pushes us below minMargin at current price, adjust price up
    const newMarginAtCurrentPrice = newCost > 0 ? ((currentPrice - newCost) / currentPrice) * 100 : 0
    if (newMarginAtCurrentPrice < p.minMargin * 100) {
      // Calculate price needed to maintain minMargin
      suggestedPrice = newCost / (1 - p.minMargin)
    }

    const newMarginPct = suggestedPrice > 0 ? ((suggestedPrice - newCost) / suggestedPrice) * 100 : 0

    return {
      productId,
      productName: p.name,
      supplierSku: p.sku,
      previousCost,
      newCost,
      costChange,
      costChangePct,
      currentPrice,
      suggestedPrice,
      currentMarginPct,
      newMarginPct,
      marginBelowThreshold: newMarginPct < p.minMargin * 100,
      minMargin: p.minMargin
    }
  } catch (error) {
    console.error('Error calculating price change:', error)
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Batch Import — Parse CSV, match SKUs, calculate changes, store records
// ──────────────────────────────────────────────────────────────────────────

export async function batchImport(
  csvContent: string,
  supplier: string = 'BOISE_CASCADE',
  vendorId?: string
): Promise<BatchImportResult> {
  const batchId = generateBatchId()
  const rows = parseCSV(csvContent)
  const matchedUpdates: SupplierPriceUpdateRecord[] = []
  const unmatchedItems: Array<{ supplierSku: string; supplierProductName: string; reason: string }> = []

  // Ensure tables exist
  await ensureTables()

  for (const row of rows) {
    const supplierSku = row.supplierSku || ''
    const supplierProductName = row.description || ''
    const newCost = row.cost || row.netPrice || 0

    if (!supplierSku && !supplierProductName) {
      unmatchedItems.push({
        supplierSku,
        supplierProductName,
        reason: 'No SKU or description provided'
      })
      continue
    }

    if (newCost <= 0) {
      unmatchedItems.push({
        supplierSku,
        supplierProductName,
        reason: 'Invalid cost (must be > 0)'
      })
      continue
    }

    // Match SKU to Abel product
    const match = await matchSKU(supplierSku, supplierProductName)
    if (!match) {
      unmatchedItems.push({
        supplierSku,
        supplierProductName,
        reason: 'No matching product found in catalog'
      })
      continue
    }

    // Calculate price change
    const priceChange = await calculatePriceChange(match.productId, newCost)
    if (!priceChange) {
      unmatchedItems.push({
        supplierSku,
        supplierProductName,
        reason: 'Error calculating price change'
      })
      continue
    }

    // Create update record
    const update: SupplierPriceUpdateRecord = {
      supplier,
      batchId,
      productId: match.productId,
      supplierSku,
      productName: match.productName,
      previousCost: priceChange.previousCost,
      newCost: priceChange.newCost,
      costChange: priceChange.costChange,
      costChangePct: priceChange.costChangePct,
      currentPrice: priceChange.currentPrice,
      suggestedPrice: priceChange.suggestedPrice,
      currentMarginPct: priceChange.currentMarginPct,
      newMarginPct: priceChange.newMarginPct,
      status: 'PENDING',
      matchType: match.matchType,
      matchConfidence: match.confidence
    }

    matchedUpdates.push(update)
  }

  // Store matched updates in database
  for (const update of matchedUpdates) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SupplierPriceUpdate"
       ("supplier", "batchId", "productId", "supplierSku", "productName",
        "previousCost", "newCost", "costChange", "costChangePct", "currentPrice",
        "suggestedPrice", "currentMarginPct", "newMarginPct", "status",
        "matchType", "matchConfidence", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
      update.supplier,
      update.batchId,
      update.productId,
      update.supplierSku,
      update.productName,
      update.previousCost,
      update.newCost,
      update.costChange,
      update.costChangePct,
      update.currentPrice,
      update.suggestedPrice,
      update.currentMarginPct,
      update.newMarginPct,
      update.status,
      update.matchType,
      update.matchConfidence
    )
  }

  // Log the sync
  await logSync({
    provider: 'BOISE_CASCADE',
    syncType: 'PRICE_IMPORT',
    recordsProcessed: rows.length,
    recordsCreated: matchedUpdates.length,
    recordsSkipped: unmatchedItems.length,
    status: matchedUpdates.length > 0 ? 'SUCCESS' : 'FAILED'
  })

  return {
    batchId,
    supplier,
    totalRows: rows.length,
    matchedProducts: matchedUpdates.length,
    unmatchedRows: unmatchedItems.length,
    matchedUpdates,
    unmatchedItems
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Batch Apply — Update Product costs and mark updates as applied
// ──────────────────────────────────────────────────────────────────────────

export async function batchApply(
  updateIds: string[],
  action: 'approve' | 'reject' | 'approve-all',
  appliedById?: string
): Promise<{
  appliedCount: number
  rejectedCount: number
  errors: string[]
}> {
  const errors: string[] = []
  let appliedCount = 0
  let rejectedCount = 0

  try {
    if (action === 'approve-all') {
      // Get all pending updates
      const pending: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, "productId", "newCost" FROM "SupplierPriceUpdate" WHERE status = 'PENDING'`
      )
      updateIds = pending.map(p => p.id)
    }

    for (const updateId of updateIds) {
      try {
        // Get the update record
        const update: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, "productId", "newCost", status FROM "SupplierPriceUpdate" WHERE id = $1`,
          updateId
        )

        if (update.length === 0) {
          errors.push(`Update ${updateId} not found`)
          continue
        }

        const rec = update[0]

        if (action === 'approve' || action === 'approve-all') {
          // Update product cost
          await prisma.$executeRawUnsafe(
            `UPDATE "Product" SET cost = $1, "updatedAt" = NOW() WHERE id = $2`,
            rec.newCost,
            rec.productId
          )

          // Mark as applied
          await prisma.$executeRawUnsafe(
            `UPDATE "SupplierPriceUpdate"
             SET status = 'APPROVED', "appliedAt" = NOW(), "appliedById" = $1, "updatedAt" = NOW()
             WHERE id = $2`,
            appliedById || 'system',
            updateId
          )

          appliedCount++
        } else if (action === 'reject') {
          // Mark as rejected
          await prisma.$executeRawUnsafe(
            `UPDATE "SupplierPriceUpdate"
             SET status = 'REJECTED', "appliedAt" = NOW(), "appliedById" = $1, "updatedAt" = NOW()
             WHERE id = $2`,
            appliedById || 'system',
            updateId
          )

          rejectedCount++
        }
      } catch (error) {
        errors.push(`Error processing update ${updateId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Log the sync
    await logSync({
      provider: 'BOISE_CASCADE',
      syncType: 'PRICE_APPLY',
      recordsProcessed: updateIds.length,
      recordsUpdated: appliedCount,
      recordsSkipped: rejectedCount,
      status: errors.length === 0 ? 'SUCCESS' : 'PARTIAL',
      errorMessage: errors.length > 0 ? errors.join('; ') : undefined
    })

    return { appliedCount, rejectedCount, errors }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    errors.push(`Batch apply failed: ${errorMsg}`)
    return { appliedCount, rejectedCount, errors }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Price Alert Generator — Flag items below minMargin threshold
// ──────────────────────────────────────────────────────────────────────────

export async function getPriceAlerts(): Promise<
  Array<{
    batchId: string
    productId: string
    productName: string
    newCost: number
    suggestedPrice: number
    currentPrice: number
    marginPct: number
    minMargin: number
    status: string
  }>
> {
  try {
    const alerts: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT ON (spu."productId")
        spu.id, spu."batchId", spu."productId", spu."productName",
        spu."newCost", spu."suggestedPrice", spu."currentPrice",
        spu."newMarginPct", p."minMargin", spu.status
       FROM "SupplierPriceUpdate" spu
       JOIN "Product" p ON spu."productId" = p.id
       WHERE spu."newMarginPct" < (p."minMargin" * 100)
       AND spu.status = 'PENDING'
       ORDER BY spu."productId", spu."createdAt" DESC`
    )

    return alerts.map((a: any) => ({
      batchId: a.batchId,
      productId: a.productId,
      productName: a.productName,
      newCost: a.newCost,
      suggestedPrice: a.suggestedPrice,
      currentPrice: a.currentPrice,
      marginPct: a.newMarginPct,
      minMargin: a.minMargin * 100,
      status: a.status
    }))
  } catch (error) {
    console.error('Error getting price alerts:', error)
    return []
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────────────────

function generateBatchId(): string {
  return `BOISE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

async function ensureTables() {
  try {
    // Create SupplierPriceUpdate table if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupplierPriceUpdate" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        supplier TEXT NOT NULL,
        "batchId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "supplierSku" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "previousCost" NUMERIC(12, 2) NOT NULL,
        "newCost" NUMERIC(12, 2) NOT NULL,
        "costChange" NUMERIC(12, 2) NOT NULL,
        "costChangePct" NUMERIC(8, 4) NOT NULL,
        "currentPrice" NUMERIC(12, 2) NOT NULL,
        "suggestedPrice" NUMERIC(12, 2),
        "currentMarginPct" NUMERIC(8, 4),
        "newMarginPct" NUMERIC(8, 4),
        "matchType" TEXT,
        "matchConfidence" NUMERIC(5, 4),
        status TEXT NOT NULL DEFAULT 'PENDING',
        "appliedAt" TIMESTAMP WITH TIME ZONE,
        "appliedById" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_batch_id"
      ON "SupplierPriceUpdate"("batchId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_product_id"
      ON "SupplierPriceUpdate"("productId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_status"
      ON "SupplierPriceUpdate"(status)
    `)
  } catch (error) {
    console.error('Error creating tables:', error)
  }
}

async function logSync(params: {
  provider: string
  syncType: string
  recordsProcessed: number
  recordsCreated?: number
  recordsUpdated?: number
  recordsSkipped?: number
  status: string
  errorMessage?: string
}) {
  try {
    const startedAt = new Date()
    const completedAt = new Date()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SyncLog"
       (provider, "syncType", direction, status, "recordsProcessed",
        "recordsCreated", "recordsUpdated", "recordsSkipped", "errorMessage",
        "startedAt", "completedAt", "durationMs", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      params.provider,
      params.syncType,
      'PULL',
      params.status,
      params.recordsProcessed,
      params.recordsCreated || 0,
      params.recordsUpdated || 0,
      params.recordsSkipped || 0,
      params.errorMessage || null,
      startedAt,
      completedAt,
      0
    )
  } catch (error) {
    console.error('Error logging sync:', error)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Batch History
// ──────────────────────────────────────────────────────────────────────────

export async function getBatchHistory(limit: number = 20) {
  try {
    const batches: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "batchId" FROM "SupplierPriceUpdate"
       ORDER BY "createdAt" DESC LIMIT $1`,
      limit
    )

    const history = []
    for (const batch of batches) {
      const stats: any[] = await prisma.$queryRawUnsafe(
        `SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
          AVG("costChangePct") as avg_cost_change_pct,
          MIN("createdAt") as created_at
         FROM "SupplierPriceUpdate"
         WHERE "batchId" = $1`,
        batch.batchId
      )

      if (stats.length > 0) {
        history.push({
          batchId: batch.batchId,
          ...stats[0]
        })
      }
    }

    return history
  } catch (error) {
    console.error('Error getting batch history:', error)
    return []
  }
}
