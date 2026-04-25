export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/brain-sync
// Pulls entity data from the NUC Brain API and syncs into Aegis tables:
//   • Communities  → from Brain community entities
//   • BuilderOrganization → from Brain builder/customer entities
//   • Jobs         → address enrichment from Brain entity data
//   • Scores       → entity health scores (A-F) from Brain scoring engine
//
// The Brain API lives at brain.abellumber.com/brain/* behind CF Access.
// This cron calls it directly (not via proxy) using CF service token.
// ──────────────────────────────────────────────────────────────────────────

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function brainFetch(path: string, timeout = 25000): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainSync/1.0',
  }

  const cfClientId = process.env.CF_ACCESS_CLIENT_ID
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfClientId && cfClientSecret) {
    headers['CF-Access-Client-Id'] = cfClientId
    headers['CF-Access-Client-Secret'] = cfClientSecret
  }
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) headers['X-API-Key'] = brainApiKey

  const response = await fetch(`${BRAIN_BASE_URL}/brain/${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Brain API ${response.status}: ${text.substring(0, 200)}`)
  }

  return response.json()
}

// ──────────────────────────────────────────────────────────────────────────
// Entity sync logic
// ──────────────────────────────────────────────────────────────────────────

interface SyncStats {
  communitiesCreated: number
  communitiesUpdated: number
  orgsCreated: number
  orgsUpdated: number
  jobsEnriched: number
  scoresUpdated: number
  productsCreated: number
  productsUpdated: number
  inventoryCreated: number
  inventoryUpdated: number
  vendorsCreated: number
  vendorsUpdated: number
  errors: string[]
}

async function syncCommunityEntities(entities: any[], stats: SyncStats) {
  const communityEntities = entities.filter(
    (e: any) => e.type === 'community' || e.type === 'subdivision' || e.type === 'project'
  )

  for (const entity of communityEntities) {
    try {
      const name = entity.name || entity.label || entity.title
      if (!name) continue

      // Try to find the builder this community belongs to
      let builderId: string | null = null
      if (entity.builderId || entity.builder_id) {
        builderId = entity.builderId || entity.builder_id
      } else if (entity.builderName || entity.builder) {
        const builderMatch: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Builder" WHERE "companyName" ILIKE $1 LIMIT 1`,
          `%${entity.builderName || entity.builder}%`
        )
        if (builderMatch.length > 0) builderId = builderMatch[0].id
      }

      if (!builderId) {
        // Default to first active builder if we can't resolve
        const defaultBuilder: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Builder" WHERE "status"::text = 'ACTIVE' ORDER BY "companyName" ASC LIMIT 1`
        )
        if (defaultBuilder.length > 0) builderId = defaultBuilder[0].id
        else continue // Can't create community without a builder
      }

      // Check if community already exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Community"
         WHERE ("name" ILIKE $1 AND "builderId" = $2)
            OR ("code" = $3 AND $3 IS NOT NULL)
            OR ("boltId" = $4 AND $4 IS NOT NULL)
         LIMIT 1`,
        name,
        builderId,
        entity.code || entity.externalCode || null,
        entity.id || null
      )

      if (existing.length > 0) {
        // Update with enriched data from brain
        await prisma.$executeRawUnsafe(
          `UPDATE "Community" SET
            "address" = COALESCE($1, "address"),
            "city" = COALESCE($2, "city"),
            "state" = COALESCE($3, "state"),
            "zip" = COALESCE($4, "zip"),
            "county" = COALESCE($5, "county"),
            "totalLots" = CASE WHEN $6 > 0 THEN $6 ELSE "totalLots" END,
            "activeLots" = CASE WHEN $7 > 0 THEN $7 ELSE "activeLots" END,
            "phase" = COALESCE($8, "phase"),
            "division" = COALESCE($9, "division"),
            "notes" = CASE WHEN $10 IS NOT NULL THEN COALESCE("notes", '') || E'\n[Brain] ' || $10 ELSE "notes" END,
            "updatedAt" = NOW()
          WHERE "id" = $11`,
          entity.address || entity.street || null,
          entity.city || null,
          entity.state || entity.stateCode || null,
          entity.zip || entity.postalCode || null,
          entity.county || null,
          Number(entity.totalLots || entity.lots || 0) || 0,
          Number(entity.activeLots || 0) || 0,
          entity.phase || null,
          entity.division || entity.market || null,
          entity.summary || entity.description || null,
          existing[0].id
        )
        stats.communitiesUpdated++
      } else {
        // Create new community from brain data
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Community" (
            "id", "builderId", "name", "code", "address", "city", "state", "zip", "county",
            "totalLots", "activeLots", "phase", "status", "division", "notes",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13::"CommunityStatus", $14, $15,
            NOW(), NOW()
          )`,
          generateId('com'),
          builderId,
          name,
          entity.code || entity.externalCode || name.substring(0, 10).toUpperCase().replace(/\s/g, ''),
          entity.address || entity.street || null,
          entity.city || null,
          entity.state || entity.stateCode || null,
          entity.zip || entity.postalCode || null,
          entity.county || null,
          Number(entity.totalLots || entity.lots || 0) || 0,
          Number(entity.activeLots || 0) || 0,
          entity.phase || null,
          entity.status === 'closed' ? 'CLOSED' : entity.status === 'winding_down' ? 'WINDING_DOWN' : 'ACTIVE',
          entity.division || entity.market || null,
          entity.summary ? `[Brain] ${entity.summary}` : null
        )
        stats.communitiesCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Community "${entity.name}": ${err.message}`)
    }
  }
}

async function syncBuilderOrgEntities(entities: any[], stats: SyncStats) {
  const orgEntities = entities.filter(
    (e: any) => e.type === 'builder' || e.type === 'customer' || e.type === 'organization'
  )

  for (const entity of orgEntities) {
    try {
      const name = entity.name || entity.label || entity.title
      if (!name) continue

      // Check if org already exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "BuilderOrganization"
         WHERE "name" ILIKE $1 OR "code" = $2
         LIMIT 1`,
        name,
        entity.code || entity.externalCode || name.substring(0, 10).toUpperCase().replace(/\s/g, '')
      )

      if (existing.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "BuilderOrganization" SET
            "contactName" = COALESCE($1, "contactName"),
            "email" = COALESCE($2, "email"),
            "phone" = COALESCE($3, "phone"),
            "address" = COALESCE($4, "address"),
            "city" = COALESCE($5, "city"),
            "state" = COALESCE($6, "state"),
            "zip" = COALESCE($7, "zip"),
            "creditLimit" = CASE WHEN $8 > 0 THEN $8 ELSE "creditLimit" END,
            "updatedAt" = NOW()
          WHERE "id" = $9`,
          entity.contactName || entity.contact || null,
          entity.email || null,
          entity.phone || null,
          entity.address || null,
          entity.city || null,
          entity.state || null,
          entity.zip || null,
          Number(entity.creditLimit || 0) || 0,
          existing[0].id
        )
        stats.orgsUpdated++
      } else {
        const code = (entity.code || name.substring(0, 10).toUpperCase().replace(/\s/g, '')).substring(0, 20)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BuilderOrganization" (
            "name", "code", "type", "contactName", "email", "phone",
            "address", "city", "state", "zip",
            "creditLimit", "notes", "active"
          ) VALUES ($1, $2, $3::"OrgType", $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
          ON CONFLICT DO NOTHING`,
          name,
          code,
          entity.orgType === 'custom' ? 'CUSTOM' : 'NATIONAL',
          entity.contactName || entity.contact || null,
          entity.email || null,
          entity.phone || null,
          entity.address || null,
          entity.city || null,
          entity.state || null,
          entity.zip || null,
          Number(entity.creditLimit || 0) || null,
          entity.summary ? `[Brain] ${entity.summary}` : null
        )
        stats.orgsCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Org "${entity.name}": ${err.message}`)
    }
  }
}

async function enrichJobAddresses(entities: any[], stats: SyncStats) {
  // Find entities with job/address data and match to existing jobs
  const jobEntities = entities.filter(
    (e: any) => e.type === 'job' || e.type === 'work_order' || e.type === 'lot' ||
                (e.address && (e.lot || e.lotBlock || e.community))
  )

  for (const entity of jobEntities) {
    try {
      const address = entity.address || entity.jobAddress || entity.street ||
        [entity.streetNumber, entity.streetName].filter(Boolean).join(' ') || null
      if (!address) continue

      // Build address with city/state/zip
      const fullAddress = [
        address,
        entity.city,
        entity.state || entity.stateCode,
        entity.zip || entity.postalCode,
      ].filter(Boolean).join(', ')

      // Try to match to existing job
      let matched = false

      // Match by brain entity ID
      if (entity.id) {
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET
            "jobAddress" = COALESCE(NULLIF($1, ''), "jobAddress"),
            "updatedAt" = NOW()
          WHERE ("boltJobId" = $2 OR "hyphenJobId" = $2)
            AND ("jobAddress" IS NULL OR "jobAddress" = '')
          `,
          fullAddress,
          entity.id
        )
        if ((result as any) > 0) { stats.jobsEnriched++; matched = true }
      }

      // Match by community + lot/block
      if (!matched && (entity.community || entity.subdivision) && (entity.lot || entity.lotBlock)) {
        const communityName = entity.community || entity.subdivision
        const lotBlock = entity.lotBlock || entity.lot
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET
            "jobAddress" = COALESCE(NULLIF($1, ''), "jobAddress"),
            "updatedAt" = NOW()
          WHERE "community" ILIKE $2
            AND "lotBlock" = $3
            AND ("jobAddress" IS NULL OR "jobAddress" = '')
          `,
          fullAddress,
          `%${communityName}%`,
          lotBlock
        )
        if ((result as any) > 0) { stats.jobsEnriched++; matched = true }
      }
    } catch (err: any) {
      stats.errors.push(`Job enrich "${entity.id}": ${err.message}`)
    }
  }
}

async function syncProductEntities(entities: any[], stats: SyncStats) {
  const productEntities = entities.filter(
    (e: any) => e.type && (e.type.toLowerCase().includes('product') || e.type.toLowerCase().includes('sku'))
  )

  for (const entity of productEntities) {
    try {
      const sku = entity.sku || entity.code || entity.id
      const name = entity.name || entity.label || entity.title
      if (!sku || !name) continue

      const category = entity.category || entity.categoryName || 'General'
      const cost = Number(entity.cost || entity.unitCost || 0) || 0
      const basePrice = Number(entity.basePrice || entity.price || entity.listPrice || 0) || 0
      const active = entity.active !== false // Default true unless explicitly false

      // Check if product already exists by SKU
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`,
        sku
      )

      if (existing.length > 0) {
        // Update existing product
        await prisma.$executeRawUnsafe(
          `UPDATE "Product" SET
            "name" = COALESCE($1, "name"),
            "category" = COALESCE($2, "category"),
            "cost" = CASE WHEN $3 > 0 THEN $3 ELSE "cost" END,
            "basePrice" = CASE WHEN $4 > 0 THEN $4 ELSE "basePrice" END,
            "active" = COALESCE($5, "active"),
            "description" = COALESCE($6, "description"),
            "updatedAt" = NOW()
          WHERE "sku" = $7`,
          name,
          category,
          cost,
          basePrice,
          active,
          entity.description || entity.summary || null,
          sku
        )
        stats.productsUpdated++
      } else {
        // Create new product
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Product" (
            "id", "sku", "name", "category", "cost", "basePrice", "active",
            "description", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          generateId('prod'),
          sku,
          name,
          category,
          cost,
          basePrice,
          active,
          entity.description || entity.summary || null
        )
        stats.productsCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Product "${entity.sku || entity.id}": ${err.message}`)
    }
  }
}

async function syncInventoryEntities(entities: any[], stats: SyncStats) {
  // Filter entities with inventory/stock data
  const inventoryEntities = entities.filter(
    (e: any) => (e.event_type === 'products' || e.type === 'inventory' || e.type === 'stock') &&
                (e.stock !== undefined || e.inventory !== undefined || e.onHand !== undefined)
  )

  for (const entity of inventoryEntities) {
    try {
      const sku = entity.sku || entity.productSku || entity.code || entity.id
      if (!sku) continue

      // Find product by SKU to get productId
      const product: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`,
        sku
      )
      if (product.length === 0) continue // Skip if product not found

      const productId = product[0].id
      const onHand = Number(entity.onHand || entity.stock || entity.inventory || 0) || 0
      const location = entity.location || entity.warehouseLocation || entity.warehouse || 'MAIN_WAREHOUSE'
      const status = onHand > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'

      // Check if inventory record exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`,
        productId
      )

      if (existing.length > 0) {
        // Update existing inventory
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem" SET
            "onHand" = $1,
            "location" = $2,
            "status" = $3,
            "sku" = COALESCE($4, "sku"),
            "lastReceivedAt" = NOW(),
            "updatedAt" = NOW()
          WHERE "productId" = $5`,
          onHand,
          location,
          status,
          sku,
          productId
        )
        stats.inventoryUpdated++
      } else {
        // Create new inventory record
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InventoryItem" (
            "id", "productId", "sku", "onHand", "location", "status",
            "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          generateId('inv'),
          productId,
          sku,
          onHand,
          location,
          status
        )
        stats.inventoryCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Inventory "${entity.sku || entity.id}": ${err.message}`)
    }
  }
}

async function syncVendorEntities(entities: any[], stats: SyncStats) {
  const vendorEntities = entities.filter(
    (e: any) => e.type === 'vendor' || e.type === 'supplier'
  )

  for (const entity of vendorEntities) {
    try {
      const name = entity.name || entity.label || entity.title
      if (!name) continue

      // Generate vendor code from name initials or use provided code
      let vendorCode = entity.code || entity.vendorCode
      if (!vendorCode) {
        // Generate from name: "Boise Cascade" → "BC", "DW Distribution" → "DW"
        const initials = name
          .split(/\s+/)
          .map((word: string) => word.charAt(0).toUpperCase())
          .join('')
          .substring(0, 10)
        vendorCode = initials || 'V' + Date.now().toString(36).substring(0, 4)
      }

      const contactName = entity.contactName || entity.contact || null
      const email = entity.email || null
      const phone = entity.phone || entity.phoneNumber || null
      const active = entity.active !== false

      // Check if vendor already exists by code
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Vendor" WHERE "code" = $1 LIMIT 1`,
        vendorCode
      )

      if (existing.length > 0) {
        // Update existing vendor
        await prisma.$executeRawUnsafe(
          `UPDATE "Vendor" SET
            "name" = COALESCE($1, "name"),
            "contactName" = COALESCE($2, "contactName"),
            "email" = COALESCE($3, "email"),
            "phone" = COALESCE($4, "phone"),
            "active" = $5,
            "updatedAt" = NOW()
          WHERE "code" = $6`,
          name,
          contactName,
          email,
          phone,
          active,
          vendorCode
        )
        stats.vendorsUpdated++
      } else {
        // Create new vendor
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Vendor" (
            "id", "name", "code", "contactName", "email", "phone", "active",
            "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          generateId('vend'),
          name,
          vendorCode,
          contactName,
          email,
          phone,
          active
        )
        stats.vendorsCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Vendor "${entity.name || entity.code}": ${err.message}`)
    }
  }
}

async function syncScores(stats: SyncStats) {
  try {
    const scoresData = await brainFetch('scores')
    const scores = Array.isArray(scoresData) ? scoresData : (scoresData.scores || scoresData.entities || [])

    if (scores.length === 0) return

    // Store latest scores in AgentConfig
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "AgentConfig" WHERE "agentRole" = 'brain' AND "configKey" = 'entity_scores' LIMIT 1`
    )

    const scorePayload = JSON.stringify({
      scores,
      syncedAt: new Date().toISOString(),
      count: scores.length,
    })

    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig" SET "configValue" = $1::jsonb, "updatedAt" = NOW() WHERE "agentRole" = 'brain' AND "configKey" = 'entity_scores'`,
        scorePayload
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description", "updatedBy", "createdAt", "updatedAt")
         VALUES ($1, 'brain', 'entity_scores', $2::jsonb, 'Brain entity scores from sync', 'brain-sync', NOW(), NOW())`,
        generateId('ac'),
        scorePayload
      )
    }

    // Create alerts for D/F scored entities
    for (const score of scores) {
      if (score.grade === 'D' || score.grade === 'F') {
        const alertTitle = `${score.grade} Grade: ${score.name || score.entityId}`
        const alertBody = `Entity "${score.name || score.entityId}" scored ${score.grade} (${score.score || 'N/A'}/100). ${score.reason || score.summary || ''}`

        // Check for existing recent alert on same entity
        const recentAlert: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "InboxItem"
           WHERE "type" = 'ALERT' AND "entityId" = $1
             AND "createdAt" > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          score.entityId || score.id || score.name
        )

        if (recentAlert.length === 0) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InboxItem" (
              "id", "type", "title", "description", "priority", "status",
              "entityType", "entityId", "source",
              "createdAt", "updatedAt"
            ) VALUES ($1, 'ALERT', $2, $3, $4, 'PENDING', $5, $6, 'brain-sync', NOW(), NOW())`,
            generateId('inb'),
            alertTitle,
            alertBody,
            score.grade === 'F' ? 'HIGH' : 'MEDIUM',
            score.type || 'entity',
            score.entityId || score.id || score.name
          )
        }
      }
      stats.scoresUpdated++
    }
  } catch (err: any) {
    // Scores endpoint may not exist — don't fail the whole sync
    stats.errors.push(`Scores sync: ${err.message}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('brain-sync', 'schedule')
  const started = Date.now()

  const stats: SyncStats = {
    communitiesCreated: 0,
    communitiesUpdated: 0,
    orgsCreated: 0,
    orgsUpdated: 0,
    jobsEnriched: 0,
    scoresUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    inventoryCreated: 0,
    inventoryUpdated: 0,
    vendorsCreated: 0,
    vendorsUpdated: 0,
    errors: [],
  }

  try {
    // 1. Check brain health first
    let brainHealthy = false
    try {
      const health = await brainFetch('health', 10000)
      brainHealthy = health?.status === 'ok' || health?.status === 'healthy' || !!health
    } catch {
      // Brain might be offline — that's OK, we'll skip gracefully
    }

    if (!brainHealthy) {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { skipped: true, reason: 'Brain engine unreachable or unhealthy' },
      })
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Brain engine unreachable — skipping sync',
      })
    }

    // 2. Pull all entities from brain
    let allEntities: any[] = []
    try {
      const entitiesData = await brainFetch('entities?limit=500')
      allEntities = Array.isArray(entitiesData)
        ? entitiesData
        : (entitiesData.entities || entitiesData.data || [])
    } catch (err: any) {
      stats.errors.push(`Entity fetch: ${err.message}`)
    }

    // 3. Sync each entity type
    if (allEntities.length > 0) {
      await syncCommunityEntities(allEntities, stats)
      await syncBuilderOrgEntities(allEntities, stats)
      await enrichJobAddresses(allEntities, stats)
      await syncProductEntities(allEntities, stats)
      await syncInventoryEntities(allEntities, stats)
      await syncVendorEntities(allEntities, stats)
    }

    // 4. Pull and sync scores
    await syncScores(stats)

    // 5. Record last sync timestamp
    const syncTimestamp = new Date().toISOString()
    const existingTs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "AgentConfig" WHERE "agentRole" = 'brain' AND "configKey" = 'brain_sync_last' LIMIT 1`
    )
    if (existingTs.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig" SET "configValue" = $1::jsonb, "updatedAt" = NOW() WHERE "agentRole" = 'brain' AND "configKey" = 'brain_sync_last'`,
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description", "updatedBy", "createdAt", "updatedAt")
         VALUES ($1, 'brain', 'brain_sync_last', $2::jsonb, 'Brain sync last-run timestamp + stats', 'brain-sync', NOW(), NOW())`,
        generateId('ac'),
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    }

    const allSuccess = stats.errors.length === 0
    const payload = {
      success: allSuccess,
      timestamp: syncTimestamp,
      entitiesFetched: allEntities.length,
      stats: {
        communitiesCreated: stats.communitiesCreated,
        communitiesUpdated: stats.communitiesUpdated,
        orgsCreated: stats.orgsCreated,
        orgsUpdated: stats.orgsUpdated,
        jobsEnriched: stats.jobsEnriched,
        scoresUpdated: stats.scoresUpdated,
        productsCreated: stats.productsCreated,
        productsUpdated: stats.productsUpdated,
        inventoryCreated: stats.inventoryCreated,
        inventoryUpdated: stats.inventoryUpdated,
        vendorsCreated: stats.vendorsCreated,
        vendorsUpdated: stats.vendorsUpdated,
      },
      errors: stats.errors.length > 0 ? stats.errors.slice(0, 20) : undefined,
    }

    await finishCronRun(runId, allSuccess ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: payload,
      error: allSuccess ? undefined : `${stats.errors.length} errors during sync`,
    })

    return NextResponse.json(payload, { status: allSuccess ? 200 : 207 })
  } catch (error: any) {
    console.error('Brain sync cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error.message, stats },
      { status: 500 }
    )
  }
}

// Also support POST for manual trigger
export async function POST(request: NextRequest) {
  return GET(request)
}
