export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

/**
 * POST /api/admin/sync-catalog
 * Imports Abel_Catalog_CLEAN.xlsx into the Product table + BomEntry.
 *
 * Body options:
 *   { dryRun?: boolean, skipBom?: boolean, bomOnly?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dryRun === true
    const skipBom = body.skipBom === true
    const bomOnly = body.bomOnly === true

    // Locate the XLSX file
    const possiblePaths = [
      path.resolve(process.cwd(), '../Abel_Catalog_CLEAN.xlsx'),
      path.resolve(process.cwd(), 'Abel_Catalog_CLEAN.xlsx'),
      '/sessions/jolly-happy-carson/mnt/Abel Lumber/Abel_Catalog_CLEAN.xlsx',
    ]

    let catalogPath = ''
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        catalogPath = p
        break
      }
    }

    if (!catalogPath) {
      return NextResponse.json({
        error: 'Abel_Catalog_CLEAN.xlsx not found',
        searchedPaths: possiblePaths,
      }, { status: 404 })
    }

    // Read workbook
    const workbook = XLSX.readFile(catalogPath)
    const sheets = workbook.SheetNames
    const log: string[] = [`Catalog sync started (${dryRun ? 'DRY RUN' : 'LIVE'})`]
    log.push(`Source: ${catalogPath}`)
    log.push(`Sheets: ${sheets.join(', ')}`)

    const results: any = { dryRun, products: null, bom: null, validation: null }

    // ── Product Master Sync ──
    if (!bomOnly) {
      const productSheet = workbook.Sheets[sheets[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(productSheet)
      log.push(`Product Master: ${rows.length} rows`)

      let upserted = 0
      let skipped = 0
      let errors = 0
      const errorDetails: string[] = []

      for (const row of rows) {
        try {
          const sku = cleanStr(row['SKU'])
          if (!sku) { skipped++; continue }

          const name = cleanStr(row['Product Name']) || sku
          const cleanCat = cleanStr(row['Clean Category']) || 'Other'
          const cost = cleanNum(row['Unit Cost'])
          const listPrice = cleanNum(row['Default List Price'])
          // Price fallback: list price → cost * 1.35 markup → 0 (for service items / TBD pricing)
          const basePrice = listPrice > 0 ? listPrice : (cost > 0 ? Math.round(cost * 1.35 * 100) / 100 : 0)
          const margin = listPrice > 0 && cost > 0 ? (listPrice - cost) / listPrice : 0.25
          const minMargin = Math.max(0.10, Math.min(margin, 0.60))
          const isActive = row['Is Active'] !== false && row['Is Active'] !== null

          const data = {
            name,
            displayName: name,
            category: mapCategory(cleanCat),
            subcategory: mapSubcategory(cleanCat) || cleanStr(row['Product Type']),
            cost,
            basePrice,
            minMargin,
            doorSize: normDoorSize(cleanStr(row['Door Size'])),
            handing: cleanStr(row['Handing']),
            coreType: cleanStr(row['Core Type']),
            panelStyle: cleanStr(row['Panel Style']),
            jambSize: cleanStr(row['Jamb Size']),
            casingCode: normCasing(cleanStr(row['Casing'])),
            hardwareFinish: normFinish(cleanStr(row['Hardware Finish'])),
            material: cleanStr(row['Material']),
            fireRating: cleanStr(row['Fire Rating']),
            active: isActive,
            inStock: true,
            inflowCategory: cleanStr(row['Original InFlow Category']),
            lastSyncedAt: new Date(),
          }

          if (!dryRun) {
            await prisma.product.upsert({
              where: { sku },
              create: { sku, ...data },
              update: data,
            })
          }
          upserted++
        } catch (err: any) {
          errors++
          if (errorDetails.length < 5) {
            errorDetails.push(`SKU "${row['SKU']}": ${err.message}`)
          }
        }
      }

      results.products = { upserted, skipped, errors, errorDetails }
      log.push(`Products: ${upserted} upserted, ${skipped} skipped, ${errors} errors`)
    }

    // ── BOM Sync ──
    if (!skipBom) {
      const bomSheetName = sheets.find(s => s.toLowerCase().includes('bom'))
      if (bomSheetName) {
        const bomSheet = workbook.Sheets[bomSheetName]
        const bomRows: any[] = XLSX.utils.sheet_to_json(bomSheet)
        log.push(`BOM Explorer: ${bomRows.length} rows`)

        // Build lookup tables
        const products: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, sku, name FROM "Product" WHERE active = true`
        )
        const skuToId: Record<string, string> = {}
        const nameToId: Record<string, string> = {}
        for (const p of products) {
          skuToId[p.sku] = p.id
          nameToId[p.name.toLowerCase()] = p.id
        }

        // Clear existing BOM
        if (!dryRun) {
          await prisma.bomEntry.deleteMany({})
        }

        let created = 0
        let skippedBom = 0
        let bomErrors = 0

        for (const row of bomRows) {
          try {
            const parentSku = cleanStr(row['Finished Product SKU'])
            const componentName = cleanStr(row['Component Name'])
            if (!parentSku || !componentName) { skippedBom++; continue }

            const parentId = skuToId[parentSku]
            if (!parentId) { skippedBom++; continue }

            const componentId = nameToId[componentName.toLowerCase()]
            if (!componentId) { skippedBom++; continue }

            if (parentId === componentId) { skippedBom++; continue }

            if (!dryRun) {
              await prisma.bomEntry.create({
                data: {
                  parentId,
                  componentId,
                  quantity: cleanNum(row['Quantity']) || 1,
                  componentType: cleanStr(row['Component Type']),
                },
              })
            }
            created++
          } catch (err: any) {
            bomErrors++
          }
        }

        results.bom = { created, skipped: skippedBom, errors: bomErrors }
        log.push(`BOM: ${created} created, ${skippedBom} skipped, ${bomErrors} errors`)
      }
    }

    // ── Validation ──
    if (!dryRun) {
      const cats: any[] = await prisma.$queryRawUnsafe(
        `SELECT category, COUNT(*)::int as count FROM "Product" WHERE active = true GROUP BY category ORDER BY count DESC`
      )
      const total: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Product"`)
      const active: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Product" WHERE active = true`)
      const withCost: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Product" WHERE cost > 0`)
      const withPrice: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Product" WHERE "basePrice" > 0`)
      const bomCount: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "BomEntry"`)

      results.validation = {
        categories: cats,
        total: total[0]?.count,
        active: active[0]?.count,
        withCost: withCost[0]?.count,
        withPrice: withPrice[0]?.count,
        bomEntries: bomCount[0]?.count,
      }
    }

    return NextResponse.json({
      success: true,
      log,
      results,
    })
  } catch (error: any) {
    console.error('Catalog sync error:', error)
    return NextResponse.json({
      error: 'Sync failed',
      message: error.message,
    }, { status: 500 })
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
function cleanStr(val: any): string | null {
  if (val === undefined || val === null || String(val).trim() === '') return null
  return String(val).trim()
}

function cleanNum(val: any): number {
  if (val === undefined || val === null || String(val).trim() === '') return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

/**
 * Maps XLSX "Clean Category" names to portal-compatible category names.
 * These must align with the 9 top-level categories in PRODUCT_TAXONOMY
 * (src/lib/product-categories.ts) so the portal catalog API can filter correctly.
 */
function mapCategory(cleanCat: string): string {
  const cat = cleanCat.toLowerCase()

  // Interior Doors (covers hollow core, solid core, bifold, pocket, fire-rated)
  if (['interior door', 'hollow core', 'solid core', 'bifold', 'pocket', 'barn door'].some(x => cat.includes(x)))
    return 'Interior Doors'
  if (cat.includes('fire-rated') || cat.includes('fire rated'))
    return 'Interior Doors' // Fire-Rated → Interior Doors / Fire Rated subcategory
  if (cat.includes('hvac door'))
    return 'Interior Doors' // HVAC doors are interior specialty doors
  if (cat.includes('door slab') && !cat.includes('exterior'))
    return 'Interior Doors' // Generic door slabs → Interior Doors / Slab Only

  // Exterior Doors (covers entry, fiberglass, patio, garage-to-house)
  if (cat.includes('exterior door'))
    return 'Exterior Doors'
  if (cat.includes('patio') || cat.includes('sliding glass'))
    return 'Exterior Doors' // Patio/Sliding → Exterior Doors / Patio Doors
  if (cat.includes('garage'))
    return 'Exterior Doors' // Garage-to-House → Exterior Doors / Garage to House

  // Specialty Doors (attic, dunnage, stair parts)
  if (cat.includes('attic'))
    return 'Specialty Doors' // Attic Access + Attic Stairs
  if (cat.includes('dunnage'))
    return 'Specialty Doors'
  if (cat.includes('stair'))
    return 'Specialty Doors' // Stair Parts → Specialty Doors

  // Door Frames & Components (frames, jambs, hardware, weatherstripping, thresholds, windows)
  if (cat.includes('door frame'))
    return 'Door Frames & Components'
  if (cat.includes('jamb'))
    return 'Door Frames & Components'
  if (cat.includes('hardware'))
    return 'Door Frames & Components'
  if (cat.includes('threshold'))
    return 'Door Frames & Components'
  if (cat.includes('weather'))
    return 'Door Frames & Components'
  if (cat.includes('window'))
    return 'Door Frames & Components'

  // Trim & Moulding
  if (cat.includes('trim') || cat.includes('molding') || cat.includes('moulding'))
    return 'Trim & Moulding'

  // Glass & Inserts
  if (cat.includes('glass') || cat.includes('lite'))
    return 'Glass & Inserts'

  // Lumber & Sheet Goods
  if (cat.includes('lumber') || cat.includes('sheet good'))
    return 'Lumber & Sheet Goods'

  // Services & Labor
  if (cat.includes('service') || cat.includes('labor'))
    return 'Services & Labor'

  // Miscellaneous (building materials, closet/shelf, uncategorized)
  if (cat.includes('building material'))
    return 'Miscellaneous'
  if (cat.includes('closet') || cat.includes('shelf'))
    return 'Miscellaneous'

  return 'Miscellaneous'
}

function mapSubcategory(cleanCat: string): string | null {
  const parts = cleanCat.split(' - ')
  return parts.length > 1 ? parts.slice(1).join(' - ') : null
}

function normDoorSize(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/(\d+)["″]?\s*x\s*(\d+)/)
  return m ? `${m[1]}${m[2]}` : raw
}

function normCasing(raw: string | null): string | null {
  if (!raw) return null
  const c = raw.toLowerCase()
  if (c.includes('a-col') || c.includes('2-1/4')) return 'A-Col'
  if (c.includes('colonial') || c.includes('3-1/4') || c.includes('c-322')) return 'C-322'
  if (c.includes('no casing') || c.includes('none')) return null
  return raw
}

function normFinish(raw: string | null): string | null {
  if (!raw) return null
  const f = raw.toLowerCase()
  const map: Record<string, string> = {
    'satin nickel': 'SN', 'sn': 'SN',
    'oil rubbed bronze': 'ORB', 'orb': 'ORB',
    'black': 'BLK', 'blk': 'BLK', 'matte black': 'BLK',
    'antique brass': 'AB', 'ab': 'AB',
    'satin chrome': 'SC', 'sc': 'SC',
    'polished chrome': 'PC', 'pc': 'PC',
  }
  return map[f] || raw
}
