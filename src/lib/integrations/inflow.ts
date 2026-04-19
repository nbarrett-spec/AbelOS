// ──────────────────────────────────────────────────────────────────────────
// InFlow Inventory — Live API Integration
// REST API: https://cloudapi.inflowinventory.com/{companyId}/
// Auth: API Key in header
// Rate limit: 60 requests/minute
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { InflowProduct, InflowPurchaseOrder, SyncResult } from './types'

const INFLOW_BASE = 'https://cloudapi.inflowinventory.com'
const RATE_LIMIT_DELAY = 1050 // ~57 req/min to stay under 60

interface InflowConfig {
  apiKey: string
  companyId: string
}

async function getConfig(): Promise<InflowConfig | null> {
  const config = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'INFLOW' },
  })
  if (!config || config.status !== 'CONNECTED' || !config.apiKey || !config.companyId) {
    return null
  }
  return { apiKey: config.apiKey, companyId: config.companyId }
}

async function inflowFetch(path: string, config: InflowConfig, options?: RequestInit) {
  const url = `${INFLOW_BASE}/${config.companyId}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json;version=2026-02-24',
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`InFlow API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Product Sync ────────────────────────────────────────────────────

export async function syncProducts(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW',
      syncType: 'products',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0,
      recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured or not connected',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  let page = 1
  const MAX_PAGES = 300 // safety cap: 300 * 100 = 30,000 products max

  try {
    while (page <= MAX_PAGES) {
      const data = await inflowFetch(`/products?page=${page}&pageSize=100&includeInactive=false`, config)
      const products: InflowProduct[] = data.data || data

      if (!products.length) break

      for (const ifProduct of products) {
        try {
          const existing = await (prisma as any).product.findFirst({
            where: { OR: [{ inflowId: String(ifProduct.id) }, { sku: ifProduct.sku }] },
          })

          if (existing) {
            await (prisma as any).product.update({
              where: { id: existing.id },
              data: {
                name: ifProduct.name,
                description: ifProduct.description || existing.description,
                cost: ifProduct.cost,
                basePrice: ifProduct.price,
                active: ifProduct.isActive,
                inStock: ifProduct.quantityOnHand > 0,
                inflowId: String(ifProduct.id),
                inflowCategory: ifProduct.category || existing.inflowCategory,
                lastSyncedAt: new Date(),
              },
            })
            updated++
          } else {
            await (prisma as any).product.create({
              data: {
                sku: ifProduct.sku,
                name: ifProduct.name,
                description: ifProduct.description,
                category: ifProduct.category || 'Miscellaneous',
                subcategory: ifProduct.subcategory,
                cost: ifProduct.cost,
                basePrice: ifProduct.price,
                active: ifProduct.isActive,
                inStock: ifProduct.quantityOnHand > 0,
                inflowId: String(ifProduct.id),
                inflowCategory: ifProduct.category,
                lastSyncedAt: new Date(),
              },
            })
            created++
          }
        } catch (err) {
          failed++
          console.error(`InFlow product sync error for SKU ${ifProduct.sku}:`, err)
        }
      }

      // InFlow API may ignore pageSize and return fewer items per page (default ~20).
      // Only stop when we get an empty page — not when count < requested pageSize.
      page++

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    // Log the sync
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW',
        syncType: 'products',
        direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + updated + skipped + failed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: skipped,
        recordsFailed: failed,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    // Update last sync timestamp
    await (prisma as any).integrationConfig.update({
      where: { provider: 'INFLOW' },
      data: { lastSyncAt: completedAt, lastSyncStatus: 'success' },
    })

    return {
      provider: 'INFLOW',
      syncType: 'products',
      direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW',
        syncType: 'products',
        direction: 'PULL',
        status: 'FAILED',
        recordsProcessed: created + updated + skipped + failed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: skipped,
        recordsFailed: failed,
        errorMessage: error.message,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })
    throw error
  }
}

// ─── Inventory Sync ──────────────────────────────────────────────────

export async function syncInventory(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    let page = 1
    const MAX_PAGES = 300

    while (page <= MAX_PAGES) {
      const data = await inflowFetch(`/products?page=${page}&pageSize=200&includeInactive=false`, config)
      const products: InflowProduct[] = data.data || data

      if (!products.length) break

      for (const ifProduct of products) {
        try {
          // Find the Product record by inflowId or SKU
          const product = await (prisma as any).product.findFirst({
            where: { OR: [{ inflowId: String(ifProduct.id) }, { sku: ifProduct.sku }] },
            select: { id: true },
          })

          if (!product) {
            skipped++
            continue
          }

          // Compute inventory values (default to 0 if field missing from API)
          const onHand = ifProduct.quantityOnHand ?? 0
          const onOrder = ifProduct.quantityOnOrder ?? 0
          const committed = ifProduct.quantityCommitted ?? 0
          const available = onHand - committed

          // Upsert: create InventoryItem if it doesn't exist, update if it does
          const existing = await (prisma as any).inventoryItem.findUnique({
            where: { productId: product.id },
          })

          if (existing) {
            await (prisma as any).inventoryItem.update({
              where: { id: existing.id },
              data: {
                onHand,
                onOrder,
                committed,
                available,
              },
            })
            updated++
          } else {
            await (prisma as any).inventoryItem.create({
              data: {
                productId: product.id,
                onHand,
                onOrder,
                committed,
                available,
              },
            })
            created++
          }
        } catch (err: any) {
          failed++
          const errMsg = `SKU ${ifProduct.sku || ifProduct.id}: ${err.message}`
          errors.push(errMsg)
          console.error(`InFlow inventory sync error:`, errMsg)
        }
      }

      // InFlow API may return fewer items than requested pageSize — keep going until empty
      page++

      // Rate limiting between pages
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    } // end while

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    // Log the sync
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW',
        syncType: 'inventory',
        direction: 'PULL',
        status: failed > 0 ? (updated > 0 || created > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
        recordsProcessed: totalProcessed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: skipped,
        recordsFailed: failed,
        errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: failed > 0 ? (updated > 0 || created > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      recordsProcessed: totalProcessed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW',
        syncType: 'inventory',
        direction: 'PULL',
        status: 'FAILED',
        recordsProcessed: created + updated + skipped + failed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: skipped,
        recordsFailed: failed,
        errorMessage: error.message,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })
    return {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: updated, recordsSkipped: 0, recordsFailed: failed,
      errorMessage: error.message,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  }
}

// ─── Webhook Handler ─────────────────────────────────────────────────

export async function handleInflowWebhook(eventType: string, payload: any) {
  switch (eventType) {
    case 'product.updated':
    case 'product.created': {
      const ifProduct = payload as InflowProduct
      const existing = await (prisma as any).product.findFirst({
        where: { inflowId: String(ifProduct.id) },
      })
      if (existing) {
        await (prisma as any).product.update({
          where: { id: existing.id },
          data: {
            name: ifProduct.name,
            cost: ifProduct.cost,
            basePrice: ifProduct.price,
            active: ifProduct.isActive,
            inStock: ifProduct.quantityOnHand > 0,
            lastSyncedAt: new Date(),
          },
        })
      }
      break
    }

    case 'inventory.adjusted': {
      // Handle stock level changes
      const { productId, newQuantity, adjustmentType } = payload
      const product = await (prisma as any).product.findFirst({
        where: { inflowId: String(productId) },
      })
      if (product) {
        await (prisma as any).inventoryItem.updateMany({
          where: { productId: product.id },
          data: {
            onHand: newQuantity,
            available: newQuantity,
          },
        })
      }
      break
    }

    case 'purchaseorder.received': {
      // Handle PO receipt — update related orders and inventory
      const { purchaseOrderNumber, items: poItems } = payload

      // Update inventory for received items
      if (poItems && Array.isArray(poItems)) {
        for (const poItem of poItems) {
          try {
            const product = await (prisma as any).product.findFirst({
              where: { OR: [{ inflowId: String(poItem.productId) }, { sku: poItem.sku }] },
            })
            if (product) {
              await (prisma as any).inventoryItem.updateMany({
                where: { productId: product.id },
                data: {
                  onHand: poItem.quantityReceived || poItem.quantity,
                  updatedAt: new Date(),
                },
              })
            }
          } catch (err) {
            console.error(`PO item sync error:`, err)
          }
        }
      }
      break
    }

    case 'order.statusChanged': {
      // Handle order status updates from InFlow
      const { orderNumber, newStatus } = payload
      const statusMap: Record<string, string> = {
        'Confirmed': 'CONFIRMED',
        'In Production': 'IN_PRODUCTION',
        'Ready': 'READY_TO_SHIP',
        'Shipped': 'SHIPPED',
        'Delivered': 'DELIVERED',
        'Complete': 'COMPLETE',
      }
      const mappedStatus = statusMap[newStatus] || newStatus
      if (orderNumber) {
        await prisma.$queryRawUnsafe(
          `UPDATE "Order" SET "status" = $1::"OrderStatus", "updatedAt" = CURRENT_TIMESTAMP WHERE "orderNumber" = $2`,
          mappedStatus, orderNumber
        )
      }
      break
    }

    default:
      break
  }
}

// ─── Connection Test ─────────────────────────────────────────────────

export async function testConnection(apiKey: string, companyId: string): Promise<{ success: boolean; message: string; productCount?: number }> {
  try {
    const response = await fetch(`${INFLOW_BASE}/${companyId}/products?page=1&pageSize=1`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2026-02-24',
      },
    })

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()
    return {
      success: true,
      message: 'Connected to InFlow successfully',
      productCount: data.totalCount || data.length,
    }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Purchase Order Sync ────────────────────────────────────────────

export async function syncPurchaseOrders(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    // Get a default staff ID for createdBy on new POs
    const admins: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Staff" WHERE role::text = 'ADMIN' LIMIT 1`
    )
    const defaultStaffId = admins[0]?.id
    if (!defaultStaffId) {
      throw new Error('No admin staff found for PO sync — need a createdById')
    }

    let page = 1
    const MAX_PAGES = 500 // safety cap: 500 pages covers 10,000+ POs

    while (page <= MAX_PAGES) {
      const poList = await inflowFetch(`/purchase-orders?page=${page}&pageSize=100`, config)
      const orders: any[] = Array.isArray(poList) ? poList : (poList.data || [])

      if (orders.length === 0) break

      for (const ifPO of orders) {
        try {
          const inflowId = String(ifPO.purchaseOrderId)
          const poNumber = ifPO.orderNumber || `IF-PO-${inflowId.substring(0, 8)}`

          // Map inFlow status to POStatus
          const poStatus = mapInflowPOStatus(ifPO)

          // Find or create vendor
          const vendorId = await findOrCreateVendor(ifPO.vendorId, ifPO.shipToCompanyName, config)

          if (!vendorId) {
            skipped++
            continue
          }

          // Check if PO already exists by inflowId
          const existing: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "PurchaseOrder" WHERE "inflowId" = $1 LIMIT 1`, inflowId
          )

          if (existing.length > 0) {
            // Update existing PO
            await prisma.$executeRawUnsafe(
              `UPDATE "PurchaseOrder" SET
                "status" = $1::"POStatus",
                "subtotal" = $2, "total" = $3,
                "expectedDate" = $4,
                "notes" = $5,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "inflowId" = $6`,
              poStatus,
              parseFloat(ifPO.subTotal) || 0,
              parseFloat(ifPO.total) || 0,
              ifPO.dueDate ? new Date(ifPO.dueDate) : null,
              ifPO.orderRemarks || null,
              inflowId
            )
            updated++
          } else {
            // Create new PO
            await prisma.$executeRawUnsafe(
              `INSERT INTO "PurchaseOrder" (
                "id", "poNumber", "vendorId", "createdById", "status",
                "subtotal", "shippingCost", "total",
                "orderedAt", "expectedDate", "notes",
                "inflowId", "inflowVendorId",
                "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4::"POStatus",
                $5, $6, $7,
                $8, $9, $10,
                $11, $12,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              poNumber, vendorId, defaultStaffId, poStatus,
              parseFloat(ifPO.subTotal) || 0,
              parseFloat(ifPO.freight) || 0,
              parseFloat(ifPO.total) || 0,
              ifPO.orderDate ? new Date(ifPO.orderDate) : new Date(),
              ifPO.dueDate ? new Date(ifPO.dueDate) : null,
              ifPO.orderRemarks || null,
              inflowId, ifPO.vendorId || null
            )
            created++
          }
        } catch (err: any) {
          failed++
          errors.push(`PO ${ifPO.orderNumber}: ${err.message}`)
          console.error('InFlow PO sync error:', err.message)
        }
      }

      // InFlow API may return fewer items than requested — keep going until empty page
      page++
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
        status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
        recordsProcessed: totalProcessed, recordsCreated: created,
        recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
        errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      recordsProcessed: totalProcessed, recordsCreated: created,
      recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
        status: 'FAILED', recordsProcessed: created + updated + skipped + failed,
        recordsCreated: created, recordsUpdated: updated,
        recordsSkipped: skipped, recordsFailed: failed,
        errorMessage: error.message, startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })
    return {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message, startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  }
}

function mapInflowPOStatus(ifPO: any): string {
  if (ifPO.isCancelled) return 'CANCELLED'
  if (ifPO.inventoryStatus === 'fulfilled') return 'RECEIVED'
  if (ifPO.inventoryStatus === 'partiallyFulfilled') return 'PARTIALLY_RECEIVED'
  if (ifPO.isCompleted) return 'RECEIVED'
  if (ifPO.paymentStatus === 'paid') return 'APPROVED'
  return 'SENT_TO_VENDOR'
}

async function findOrCreateVendor(inflowVendorId: string | null, companyName: string | null, config?: InflowConfig | null): Promise<string | null> {
  if (!inflowVendorId) return null

  // Try to find by inflowVendorId first
  const byInflow: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Vendor" WHERE "inflowVendorId" = $1 LIMIT 1`, inflowVendorId
  )
  if (byInflow.length > 0) return byInflow[0].id

  // Fetch vendor name from inFlow API if we don't have a company name
  let resolvedName = companyName
  if (!resolvedName && config) {
    try {
      const vendorData = await inflowFetch(`/vendors/${inflowVendorId}`, config)
      resolvedName = vendorData?.contactName || vendorData?.name || null
    } catch { /* vendor lookup failed, continue with fallback */ }
  }

  // Try to match by company name
  if (resolvedName) {
    const byName: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Vendor" WHERE LOWER("name") = LOWER($1) LIMIT 1`, resolvedName
    )
    if (byName.length > 0) {
      // Link existing vendor to inFlow
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET "inflowVendorId" = $1 WHERE "id" = $2`, inflowVendorId, byName[0].id
      )
      return byName[0].id
    }
  }

  // Create a new vendor with the resolved name
  const vendorName = resolvedName || `InFlow Vendor ${inflowVendorId.substring(0, 8)}`
  const code = vendorName.substring(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'IF' + Date.now()

  // Ensure unique code
  const codeExists: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Vendor" WHERE "code" = $1 LIMIT 1`, code
  )
  const finalCode = codeExists.length > 0 ? code + Date.now().toString().slice(-4) : code

  const result: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO "Vendor" ("id", "name", "code", "inflowVendorId", "active", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING "id"`,
    vendorName, finalCode, inflowVendorId
  )
  return result[0]?.id || null
}

// ─── Sales Order Sync ───────────────────────────────────────────────

export async function syncSalesOrders(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    // Get or create "Unmatched InFlow Customers" builder for orders we can't match
    let unmatchedBuilder: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Builder" WHERE "companyName" = 'Unmatched InFlow Customers' LIMIT 1`
    )
    if (unmatchedBuilder.length === 0) {
      unmatchedBuilder = await prisma.$queryRawUnsafe(
        `INSERT INTO "Builder" (id, "companyName", "contactName", email, "passwordHash", phone, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, 'Unmatched InFlow Customers', 'Auto-Created by Sync', 'datafix@abellumber.com', 'NOLOGIN', '', 'ACTIVE'::"AccountStatus", NOW(), NOW())
         RETURNING id`
      )
    }
    const defaultBuilderId = unmatchedBuilder[0]?.id
    if (!defaultBuilderId) {
      throw new Error('No builders found — need at least one for sales order sync')
    }

    // Check if we need a full backload or just incremental sync
    // If fewer than 50 orders have inflowOrderId, we need to pull everything
    const inflowOrderCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Order" WHERE "inflowOrderId" IS NOT NULL`
    )
    const needsFullSync = (inflowOrderCount[0]?.count || 0) < 50

    let modifiedSince = ''
    if (!needsFullSync) {
      // Incremental: only pull recently modified orders
      try {
        const lastSync: any[] = await prisma.$queryRawUnsafe(
          `SELECT "completedAt" FROM "SyncLog"
           WHERE provider = 'INFLOW' AND "syncType" = 'salesOrders' AND status IN ('SUCCESS', 'PARTIAL')
           ORDER BY "completedAt" DESC LIMIT 1`
        )
        if (lastSync.length > 0 && lastSync[0].completedAt) {
          const since = new Date(lastSync[0].completedAt)
          since.setHours(since.getHours() - 2)
          modifiedSince = `&modifiedSince=${since.toISOString()}`
        }
      } catch (e: any) {
        console.warn('[InFlow SO Sync] Could not fetch last sync time, pulling all:', e?.message)
      }
    } else {
      console.log('[InFlow SO Sync] Full backload: only', inflowOrderCount[0]?.count, 'orders linked — pulling all from InFlow')
    }

    let page = 1
    const MAX_PAGES = 500

    while (page <= MAX_PAGES) {
      const soList = await inflowFetch(`/sales-orders?page=${page}&pageSize=100${modifiedSince}`, config)
      const orders: any[] = Array.isArray(soList) ? soList : (soList.data || [])

      if (orders.length === 0) break

      for (const ifSO of orders) {
        try {
          const inflowOrderId = String(ifSO.salesOrderId)
          const orderNumber = ifSO.orderNumber ? `IF-${ifSO.orderNumber}` : `IF-SO-${inflowOrderId.substring(0, 8)}`

          // Map inFlow status to OrderStatus
          const orderStatus = mapInflowSOStatus(ifSO)
          const paymentStatus = mapInflowPaymentStatus(ifSO.paymentStatus)

          // Try to find a matching builder by customerId
          const builderId = await findBuilderByInflowCustomer(ifSO.customerId, ifSO.contactName) || defaultBuilderId

          // Check if SO already exists
          const existing: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "Order" WHERE "inflowOrderId" = $1 LIMIT 1`, inflowOrderId
          )

          if (existing.length > 0) {
            // Update
            await prisma.$executeRawUnsafe(
              `UPDATE "Order" SET
                "status" = $1::"OrderStatus",
                "paymentStatus" = $2::"PaymentStatus",
                "subtotal" = $3, "total" = $4,
                "deliveryNotes" = $5,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "inflowOrderId" = $6`,
              orderStatus, paymentStatus,
              parseFloat(ifSO.subTotal) || 0,
              parseFloat(ifSO.total) || 0,
              ifSO.orderRemarks || null,
              inflowOrderId
            )
            updated++
          } else {
            // Create
            await prisma.$executeRawUnsafe(
              `INSERT INTO "Order" (
                "id", "builderId", "orderNumber", "poNumber",
                "subtotal", "taxAmount", "shippingCost", "total",
                "paymentTerm", "paymentStatus", "status",
                "deliveryDate", "deliveryNotes",
                "inflowOrderId", "inflowCustomerId",
                "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3,
                $4, $5, $6, $7,
                $8::"PaymentTerm", $9::"PaymentStatus", $10::"OrderStatus",
                $11, $12,
                $13, $14,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              builderId, orderNumber, ifSO.poNumber || null,
              parseFloat(ifSO.subTotal) || 0,
              parseFloat(ifSO.tax1) || 0,
              parseFloat(ifSO.orderFreight) || 0,
              parseFloat(ifSO.total) || 0,
              'PAY_ON_DELIVERY', paymentStatus, orderStatus,
              ifSO.requestedShipDate ? new Date(ifSO.requestedShipDate) : null,
              ifSO.orderRemarks || null,
              inflowOrderId, ifSO.customerId || null
            )
            created++
          }
        } catch (err: any) {
          failed++
          errors.push(`SO ${ifSO.orderNumber}: ${err.message}`)
          console.error('InFlow SO sync error:', err.message)
        }
      }

      // InFlow API may return fewer items than requested — keep going until empty page
      page++
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
        status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
        recordsProcessed: totalProcessed, recordsCreated: created,
        recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
        errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      recordsProcessed: totalProcessed, recordsCreated: created,
      recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
        status: 'FAILED', recordsProcessed: created + updated + skipped + failed,
        recordsCreated: created, recordsUpdated: updated,
        recordsSkipped: skipped, recordsFailed: failed,
        errorMessage: error.message, startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })
    return {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message, startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  }
}

function mapInflowSOStatus(ifSO: any): string {
  if (ifSO.isCancelled) return 'CANCELLED'
  if (ifSO.inventoryStatus === 'fulfilled' && ifSO.isCompleted) return 'COMPLETE'
  if (ifSO.inventoryStatus === 'fulfilled') return 'DELIVERED'
  if (ifSO.inventoryStatus === 'partiallyFulfilled') return 'SHIPPED'
  if (ifSO.isInvoiced) return 'CONFIRMED'
  return 'RECEIVED'
}

function mapInflowPaymentStatus(status: string | null): string {
  if (!status) return 'PENDING'
  switch (status.toLowerCase()) {
    case 'paid': return 'PAID'
    case 'partial': return 'INVOICED'
    case 'overdue': return 'OVERDUE'
    default: return 'PENDING'
  }
}

async function findBuilderByInflowCustomer(customerId: string | null, contactName: string | null): Promise<string | null> {
  if (!customerId) return null

  // Try matching by inflowCustomerId on existing orders
  const byInflow: any[] = await prisma.$queryRawUnsafe(
    `SELECT "builderId" FROM "Order" WHERE "inflowCustomerId" = $1 LIMIT 1`, customerId
  )
  if (byInflow.length > 0) return byInflow[0].builderId

  // Try matching by contact name against builder company/contact
  if (contactName) {
    const byName: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Builder" WHERE LOWER("companyName") ILIKE $1 OR LOWER("contactName") ILIKE $1 LIMIT 1`,
      `%${contactName.toLowerCase()}%`
    )
    if (byName.length > 0) return byName[0].id
  }

  return null
}

// ─── Push Order to InFlow ───────────────────────────────────────────

export async function pushOrderToInflow(orderId: string): Promise<{ success: boolean; message: string; inflowOrderId?: string }> {
  const config = await getConfig()
  if (!config) return { success: false, message: 'InFlow not configured' }

  try {
    // Fetch order with items and products
    const order: any = await (prisma as any).order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        project: { include: { builder: true } },
      },
    })

    if (!order) return { success: false, message: 'Order not found' }

    // Map to InFlow sales order format
    const inflowOrder = {
      orderNumber: order.orderNumber,
      customerName: order.project?.builder?.companyName || 'Unknown',
      orderDate: order.createdAt,
      requiredDate: order.deliveryDate,
      remarks: `Project: ${order.project?.name || 'N/A'}`,
      items: order.items.map((item: any) => ({
        productSku: item.product?.sku,
        description: item.description || item.product?.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    }

    const result = await inflowFetch('/salesorders', config, {
      method: 'POST',
      body: JSON.stringify(inflowOrder),
    })

    // Store InFlow order ID back in our system
    if (result?.id) {
      await prisma.$queryRawUnsafe(
        `UPDATE "Order" SET "inflowOrderId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        String(result.id), orderId
      )
    }

    return {
      success: true,
      message: `Order ${order.orderNumber} pushed to InFlow`,
      inflowOrderId: result?.id ? String(result.id) : undefined,
    }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}
