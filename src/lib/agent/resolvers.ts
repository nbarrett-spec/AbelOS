// ── Shared Data Resolvers ────────────────────────────────────────────────
// Single source of truth for all database queries the agent performs.
// Used by chat, SMS, and email routes.

import { prisma } from '@/lib/prisma'
import type { Intent } from './intents'

// ── Delivery queries ────────────────────────────────────────────────────

export async function resolveDeliveryStatus(builderId: string) {
  const deliveries: any[] = await prisma.$queryRawUnsafe(`
    SELECT d.id, d."deliveryNumber", d.status, d."scheduledDate", d.address,
           d."departedAt", d."arrivedAt", d."completedAt",
           j."jobNumber", j."community", j."jobAddress", j."lotBlock",
           c.name as "crewName"
    FROM "Delivery" d
    JOIN "Job" j ON d."jobId" = j.id
    JOIN "Order" o ON j."orderId" = o.id
    LEFT JOIN "Crew" c ON d."crewId" = c.id
    WHERE o."builderId" = $1
      AND d.status::text NOT IN ('COMPLETE', 'REFUSED')
    ORDER BY d."scheduledDate" ASC
    LIMIT 10
  `, builderId)
  return deliveries
}

// ── Schedule queries ────────────────────────────────────────────────────

export async function resolveUpcomingSchedule(builderId: string) {
  const entries: any[] = await prisma.$queryRawUnsafe(`
    SELECT se.id, se."entryType", se.title, se."scheduledDate", se."scheduledTime",
           se.status, j."jobNumber", j."community", j."jobAddress", j."lotBlock",
           c.name as "crewName"
    FROM "ScheduleEntry" se
    JOIN "Job" j ON se."jobId" = j.id
    JOIN "Order" o ON j."orderId" = o.id
    LEFT JOIN "Crew" c ON se."crewId" = c.id
    WHERE o."builderId" = $1
      AND se."scheduledDate" >= CURRENT_DATE
      AND se.status::text NOT IN ('CANCELLED', 'COMPLETED')
    ORDER BY se."scheduledDate" ASC, se."scheduledTime" ASC
    LIMIT 15
  `, builderId)
  return entries
}

// ── Order queries ───────────────────────────────────────────────────────

export async function resolveOrderStatus(builderId: string) {
  const orders: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status, o."paymentStatus", o.total,
           o."deliveryDate", o."createdAt",
           COUNT(j.id)::int as "jobCount"
    FROM "Order" o
    LEFT JOIN "Job" j ON j."orderId" = o.id
    WHERE o."builderId" = $1
      AND o.status::text NOT IN ('COMPLETE', 'CANCELLED')
    GROUP BY o.id
    ORDER BY o."createdAt" DESC
    LIMIT 10
  `, builderId)
  return orders
}

export async function resolveOrderHistory(builderId: string) {
  const orders: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status, o."paymentStatus", o.total,
           o."deliveryDate", o."createdAt"
    FROM "Order" o
    WHERE o."builderId" = $1
    ORDER BY o."createdAt" DESC
    LIMIT 20
  `, builderId)
  return orders
}

export async function resolveOrderDetail(builderId: string, message: string) {
  // Try to match SO-NNNNNN or ORD-NNNN-NNNN or just order numbers
  const soMatch = message.match(/SO[-\s]?(\d{6})/i)
  const ordMatch = message.match(/ORD[-\s]?(\d{4}[-\s]?\d{4})/i)

  let searchTerm: string | null = null
  if (soMatch) {
    searchTerm = `SO-${soMatch[1]}`
  } else if (ordMatch) {
    searchTerm = `ORD-${ordMatch[1].replace(/\s/g, '')}`
  }
  if (!searchTerm) return null

  const orders: any[] = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status, o."paymentStatus", o.total, o.subtotal,
           o."taxAmount", o."shippingCost", o."deliveryDate", o."createdAt", o."paymentTerm"
    FROM "Order" o
    WHERE o."builderId" = $1 AND o."orderNumber" ILIKE $2
    LIMIT 1
  `, builderId, `%${searchTerm}%`)
  if (orders.length === 0) return null

  const items: any[] = await prisma.$queryRawUnsafe(`
    SELECT oi.description, oi.quantity, oi."unitPrice", oi."lineTotal"
    FROM "OrderItem" oi WHERE oi."orderId" = $1
    ORDER BY oi.description
  `, orders[0].id)

  return { ...orders[0], items }
}

// ── Invoice queries ─────────────────────────────────────────────────────

export async function resolveInvoices(builderId: string) {
  const invoices: any[] = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."invoiceNumber", i.status, i.total, i."amountPaid",
           i."balanceDue", i."dueDate", i."issuedAt"
    FROM "Invoice" i
    WHERE i."builderId" = $1
    ORDER BY i."issuedAt" DESC
    LIMIT 15
  `, builderId)
  return invoices
}

// ── Product queries (improved fuzzy matching) ───────────────────────────

/** Words to remove from product search queries */
const STOP_WORDS = new Set([
  'price', 'cost', 'how', 'much', 'is', 'the', 'a', 'an', 'for', 'of',
  'what', 'pricing', 'catalog', 'do', 'does', 'can', 'i', 'get', 'buy',
  'need', 'want', 'looking', 'show', 'me', 'find', 'search',
  'available', 'in', 'stock', 'have', 'you', 'your',
])

function extractProductTerms(message: string): { searchTerm: string; sku: string | null; size: string | null; handing: string | null } {
  const m = message.toLowerCase()

  // Check for SKU pattern first (BC followed by digits)
  const skuMatch = m.match(/\b(bc\d{4,6})\b/i)
  const sku = skuMatch ? skuMatch[1].toUpperCase() : null

  // Check for door size pattern (e.g., 2068, 2868, 3068)
  const sizeMatch = m.match(/\b(\d{4})\b/)
  const size = sizeMatch ? sizeMatch[1] : null

  // Check for handing
  const handingMatch = m.match(/\b(left|right|lh|rh)\s*(hand|handing)?\b/i)
  const handing = handingMatch
    ? (handingMatch[1].toLowerCase().startsWith('l') ? 'Left Hand' : 'Right Hand')
    : null

  // Build cleaned search term by removing stop words
  const words = m.split(/\s+/).filter(w => !STOP_WORDS.has(w) && w.length > 1)
  const searchTerm = words.join(' ').trim()

  return { searchTerm, sku, size, handing }
}

export async function resolveProductPricing(builderId: string, message: string) {
  const { searchTerm, sku, size, handing } = extractProductTerms(message)

  // If we have a SKU, search by that first
  if (sku) {
    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.id, p.sku, p.name, p."displayName", p.category, p."basePrice",
             p."doorSize", p.handing, p.material, p."coreType",
             bp."customPrice",
             COALESCE(bp."customPrice", p."basePrice") as "yourPrice"
      FROM "Product" p
      LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
      WHERE p.active = true AND p.sku ILIKE $2
      ORDER BY p.name
      LIMIT 10
    `, builderId, `%${sku}%`)
    if (products.length > 0) return products
  }

  // Build a multi-field search with weighted matching
  const conditions: string[] = ['p.active = true']
  const params: any[] = [builderId]
  let idx = 2

  if (size) {
    conditions.push(`(p."doorSize" ILIKE $${idx} OR p.name ILIKE $${idx})`)
    params.push(`%${size}%`)
    idx++
  }

  if (handing) {
    conditions.push(`p.handing ILIKE $${idx}`)
    params.push(`%${handing}%`)
    idx++
  }

  // General text search across name, displayName, category, material, description
  if (searchTerm.length >= 2) {
    conditions.push(`(
      p.name ILIKE $${idx} OR p."displayName" ILIKE $${idx} OR
      p.category ILIKE $${idx} OR p.sku ILIKE $${idx} OR
      p.material ILIKE $${idx} OR p.description ILIKE $${idx}
    )`)
    params.push(`%${searchTerm}%`)
    idx++
  }

  // Need at least some search criteria beyond just active=true
  if (conditions.length < 2) return null

  const products: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.sku, p.name, p."displayName", p.category, p."basePrice",
           p."doorSize", p.handing, p.material, p."coreType",
           bp."customPrice",
           COALESCE(bp."customPrice", p."basePrice") as "yourPrice"
    FROM "Product" p
    LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.name
    LIMIT 10
  `, ...params)

  return products.length > 0 ? products : null
}

// ── Warranty queries ────────────────────────────────────────────────────

export async function resolveWarranty(builderId: string) {
  const claims: any[] = await prisma.$queryRawUnsafe(`
    SELECT wc.id, wc."claimNumber", wc.status, wc.description, wc."createdAt",
           j."jobNumber", j."jobAddress"
    FROM "WarrantyClaim" wc
    JOIN "Job" j ON wc."jobId" = j.id
    JOIN "Order" o ON j."orderId" = o.id
    WHERE o."builderId" = $1
    ORDER BY wc."createdAt" DESC
    LIMIT 10
  `, builderId)
  return claims
}

// ── Schedule availability ───────────────────────────────────────────────

export async function checkScheduleAvailability(date: string) {
  const entries: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.id, c.name, c."crewType",
           COUNT(se.id)::int as "bookings"
    FROM "Crew" c
    LEFT JOIN "ScheduleEntry" se ON se."crewId" = c.id
      AND se."scheduledDate" = $1::date
      AND se.status::text NOT IN ('CANCELLED')
    WHERE c.active = true AND c."crewType"::text IN ('DELIVERY', 'DELIVERY_AND_INSTALL')
    GROUP BY c.id
    HAVING COUNT(se.id) < 4
    ORDER BY COUNT(se.id) ASC
  `, date)
  return entries
}

// ── Master resolver ─────────────────────────────────────────────────────

export async function resolveDataForIntent(intent: Intent, builderId: string, message: string): Promise<any> {
  try {
    switch (intent) {
      case 'DELIVERY_STATUS':
      case 'DELIVERY_ETA':
      case 'DELIVERY_LIST':
        return await resolveDeliveryStatus(builderId)
      case 'SCHEDULE_VIEW':
      case 'SCHEDULE_CHANGE':
        return await resolveUpcomingSchedule(builderId)
      case 'ORDER_STATUS':
        return await resolveOrderStatus(builderId)
      case 'ORDER_HISTORY':
        return await resolveOrderHistory(builderId)
      case 'ORDER_DETAIL':
        return await resolveOrderDetail(builderId, message)
      case 'INVOICE_STATUS':
      case 'INVOICE_LIST':
        return await resolveInvoices(builderId)
      case 'PRODUCT_PRICING':
      case 'PRODUCT_AVAILABILITY':
        return await resolveProductPricing(builderId, message)
      case 'WARRANTY_STATUS':
        return await resolveWarranty(builderId)
      default:
        return null
    }
  } catch (err: any) {
    console.error(`Data resolution error for ${intent}:`, err.message)
    return null
  }
}
