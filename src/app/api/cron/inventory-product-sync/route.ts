export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/inventory-product-sync
//
// GAP-22 — Product ↔ InventoryItem sync
//
// Finds all active Products that don't have a corresponding InventoryItem
// and creates them with safe defaults:
// - onHand = 0
// - reorderPoint = 0
// - safetyStock = 5
// - maxStock = 200
//
// Auth: Bearer ${CRON_SECRET}
// Cron schedule: nightly (vercel.json)
// ──────────────────────────────────────────────────────────────────────────

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('inventory-product-sync', 'schedule')
  const started = Date.now()

  try {
    // Find all active products
    const activeProducts = await prisma.product.findMany({
      where: { active: true },
      select: { id: true, sku: true, name: true },
    })

    // Find which products already have inventory items
    const existingInventoryItems = await prisma.inventoryItem.findMany({
      where: { productId: { in: activeProducts.map((p) => p.id) } },
      select: { productId: true },
    })

    const existingProductIds = new Set(existingInventoryItems.map((i) => i.productId))

    // Identify products needing inventory items
    const productsNeedingInventory = activeProducts.filter(
      (p) => !existingProductIds.has(p.id)
    )

    // Create inventory items for orphaned products
    let created = 0
    if (productsNeedingInventory.length > 0) {
      const createMany = productsNeedingInventory.map((product) => ({
        productId: product.id,
        onHand: 0,
        reorderPoint: 0,
        safetyStock: 5,
        maxStock: 200,
      }))

      await prisma.inventoryItem.createMany({
        data: createMany,
        skipDuplicates: true,
      })

      created = createMany.length
    }

    const elapsed = Date.now() - started

    await finishCronRun(runId, 'SUCCESS', elapsed, {
      result: {
        productsChecked: activeProducts.length,
        orphanedProducts: productsNeedingInventory.length,
        inventoryItemsCreated: created,
      },
    })

    console.log(
      `[inventory-product-sync] checked ${activeProducts.length} products, created ${created} inventory items`
    )

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        productsChecked: activeProducts.length,
        orphanedProducts: productsNeedingInventory.length,
        inventoryItemsCreated: created,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('inventory-product-sync cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

// Allow manual POST trigger (same auth)
export async function POST(request: NextRequest) {
  return GET(request)
}
