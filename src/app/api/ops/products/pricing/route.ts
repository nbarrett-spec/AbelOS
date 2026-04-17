export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readFileSync } from 'fs'
import { join } from 'path'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * Simple CSV parser that handles quoted fields with commas and newlines
 */
function parseCSV(text: string): Record<string, string>[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === '\n' && !inQuotes) {
      if (current.trim()) lines.push(current)
      current = ''
    } else if (ch === '\r' && !inQuotes) {
      // skip CR
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || ''
    }
    rows.push(row)
  }
  return rows
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

const BUILDER_COLUMNS = [
  'AGD', 'Astoria Homes', 'Beaver Builders', 'BROOKFIELD', 'CAS CONSTRUCTION',
  'Country Road Homebuilders', 'Daniel', 'David Weekly Homes', 'DFW Installations',
  'FIG TREE HOMES', 'FIRST TEXAS HOMES', 'GH HOMES', 'Harvest Home Designs',
  'Hunt Homes', 'Jake Jackson', 'James Lancaster', 'JCLI Homes', 'JOSEPH PAUL HOMES',
  'Key Custom Homes', 'Malibu Homes', 'McClintock', 'Millcreek', 'NEWPORT HOMEBUILDERS',
  'Pulte ', 'Stately Design and Renovation', 'STONEHOLLOW', 'SUMMA TERRA',
  'TGC Custom Homes', 'TOLL BROTHERS', 'TRUTH CONSTRUCTION', 'TX BUILT CONST',
  'Victor Myers', 'Villa May'
]

interface CSVPricing {
  defaultPrice: number
  cost: number
  vendorPrice: number
  markup: number
  isFixedMarkup: boolean
  builderPrices: { builder: string; price: number }[]
}

function loadCSVPricing(): Map<string, CSVPricing> {
  const csvPath = join(process.cwd(), 'public', 'product-costs.csv')
  const csvText = readFileSync(csvPath, 'utf-8')
  const rows = parseCSV(csvText)

  const map = new Map<string, CSVPricing>()
  for (const row of rows) {
    const sku = row['SKU']?.trim()
    if (!sku) continue

    const builderPrices: { builder: string; price: number }[] = []
    for (const col of BUILDER_COLUMNS) {
      const val = parseFloat(row[col] || '0') || 0
      if (val > 0) builderPrices.push({ builder: col.trim(), price: val })
    }

    map.set(sku, {
      defaultPrice: parseFloat(row['DefaultUnitPrice'] || '0') || 0,
      cost: parseFloat(row['Cost'] || '0') || 0,
      vendorPrice: parseFloat(row['VendorPrice'] || '0') || 0,
      markup: parseFloat(row['Markup'] || '150') || 150,
      isFixedMarkup: row['IsFixedMarkup'] === 'TRUE',
      builderPrices,
    })
  }
  return map
}

/**
 * Tier 5: Exact sibling match — same door name minus hinge/casing variation
 */
function getBaseKey(name: string): string {
  return name
    .replace(/\s*(SN|Blk|BLK|ORB|AB|BB|SatNkl)\s*Hinge[s]?\s*/gi, ' ')
    .replace(/\s*(NO CASE|C-\d+|2-1\/4"\s*A-Col|2-1\/4"\s*Col|3-1\/4")/gi, ' ')
    .replace(/\s*\(BC\/SS\)\s*/g, '')
    .replace(/\s*\(BC\/TT\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tier 6: Handing-agnostic match — same door but LH↔RH
 */
function getHandingAgnosticKey(name: string): string {
  return getBaseKey(name)
    .replace(/\bLH\b/gi, '_HAND_')
    .replace(/\bRH\b/gi, '_HAND_')
    .replace(/\bLHIS\b/gi, '_HAND_')
    .replace(/\bRHIS\b/gi, '_HAND_')
}

/**
 * Tier 7: Core-key match — size + style + core type + jamb
 * Used for ADT products where the same door spec should have similar pricing
 */
function getCoreKey(name: string): string | null {
  const upper = name.toUpperCase()
  if (!upper.startsWith('ADT ') && !upper.startsWith('BC ') && !upper.startsWith('DW ')) return null

  // Size
  const sizeMatch = upper.match(/\b(\d{4})\b/)
  const size = sizeMatch ? sizeMatch[1] : ''

  // Style markers
  const styles: string[] = []
  if (upper.includes('6 PNL') || upper.includes('6 PANEL')) styles.push('6PNL')
  else if (upper.includes('2 PANEL SQUARE')) styles.push('2PNLSQ')
  else if (upper.includes('2 PANEL ROUND') || upper.includes('2 PNL RND')) styles.push('2PNLRD')
  else if (upper.includes('2 PANEL SHAKER') || upper.includes('2 PNL SHAKER')) styles.push('2PNLSHK')
  else if (upper.includes('1 LITE') || upper.includes('1-LITE')) styles.push('1LITE')
  else if (upper.includes('FLUSH')) styles.push('FLUSH')
  else if (upper.includes('PLANK')) styles.push('PLANK')
  else if (upper.includes('LOUVER') || upper.includes('LOUVRE')) styles.push('LOUVER')
  else if (upper.includes('CRAFTSMAN')) styles.push('CRAFT')
  else if (upper.includes('SHAKER')) styles.push('SHAKER')

  // Material modifiers that significantly affect price
  if (upper.includes('KNOTTY PINE') || upper.includes('KP ')) styles.push('KPINE')
  if (upper.includes('HEMLOCK')) styles.push('HEMLOCK')
  if (upper.includes('OAK')) styles.push('OAK')
  if (upper.includes('MAHOGANY')) styles.push('MAHOGANY')
  if (upper.includes('FIBERGLASS') || upper.match(/\bFG\b/)) styles.push('FG')

  // Core type
  const core = upper.includes('S/C') || upper.includes('1-3/4') ? 'SC' : upper.includes('H/C') || upper.includes('1-3/8') ? 'HC' : ''

  // Jamb
  const jambMatch = upper.match(/(\d+-\d\/\d+)"\s/)
  const jamb = jambMatch ? jambMatch[1] : ''

  // Twin/double
  const twin = upper.includes('TWIN') || upper.includes('DOUBLE') ? 'TWIN' : ''

  // Fire rated
  const fire = upper.includes('FIRE') || upper.includes('20 MIN') ? 'FIRE' : ''

  const style = styles.join('-') || 'STD'
  return [size, style, core, jamb, twin, fire].filter(Boolean).join('|')
}

interface PriceUpdate {
  id: string
  sku: string
  name: string
  category: string
  newPrice: number
  source: string
}

function findPrice(
  product: { id: string; sku: string; name: string; category: string },
  csvMap: Map<string, CSVPricing>,
  siblingMap: Map<string, number>,
  handingMap: Map<string, number[]>,
  coreKeyMap: Map<string, number[]>,
): PriceUpdate | null {
  const csv = csvMap.get(product.sku)

  // Tier 1: DefaultUnitPrice from CSV
  if (csv && csv.defaultPrice > 0) {
    return { ...product, newPrice: csv.defaultPrice, source: 'CSV default price' }
  }

  // Tier 2: Average builder price from CSV
  if (csv && csv.builderPrices.length > 0) {
    const avg = csv.builderPrices.reduce((s, bp) => s + bp.price, 0) / csv.builderPrices.length
    return { ...product, newPrice: Math.round(avg * 100) / 100, source: `CSV avg ${csv.builderPrices.length} builder prices` }
  }

  // Tier 3: Cost × markup from CSV
  if (csv && csv.cost > 0) {
    const price = csv.isFixedMarkup ? csv.cost + csv.markup : csv.cost * (csv.markup / 100)
    if (price > 0) {
      return { ...product, newPrice: Math.round(price * 100) / 100, source: 'CSV cost+markup' }
    }
  }

  // Tier 4: VendorPrice × markup from CSV
  if (csv && csv.vendorPrice > 0) {
    const price = csv.vendorPrice * (csv.markup / 100)
    return { ...product, newPrice: Math.round(price * 100) / 100, source: 'CSV vendor+markup' }
  }

  // Tier 5: Exact sibling (same name minus hinge/casing)
  const baseKey = getBaseKey(product.name)
  const siblingPrice = siblingMap.get(baseKey)
  if (siblingPrice && siblingPrice > 0) {
    return { ...product, newPrice: siblingPrice, source: 'Sibling exact match' }
  }

  // Tier 6: Handing-agnostic match (LH↔RH)
  const handKey = getHandingAgnosticKey(product.name)
  const handPrices = handingMap.get(handKey)
  if (handPrices && handPrices.length > 0) {
    const median = getMedian(handPrices)
    return { ...product, newPrice: median, source: `Handing match (${handPrices.length} refs)` }
  }

  // Tier 7: Core-key match (size+style+core+jamb)
  const coreKey = getCoreKey(product.name)
  if (coreKey) {
    const corePrices = coreKeyMap.get(coreKey)
    if (corePrices && corePrices.length > 0) {
      const median = getMedian(corePrices)
      // Only use if price variance is reasonable (within 40% of median)
      const spread = Math.max(...corePrices) - Math.min(...corePrices)
      if (spread / median < 0.4 || corePrices.length >= 3) {
        return { ...product, newPrice: median, source: `Core match ${coreKey} (${corePrices.length} refs)` }
      }
    }
  }

  return null
}

function getMedian(prices: number[]): number {
  const sorted = [...prices].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return Math.round(median * 100) / 100
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const csvMap = loadCSVPricing()

    // Fetch all products using raw SQL
    const zeroProducts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name", "category", "basePrice"
       FROM "Product"
       WHERE "active" = true AND "basePrice" = 0`
    )
    const pricedProducts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name", "category", "basePrice"
       FROM "Product"
       WHERE "active" = true AND "basePrice" > 0`
    )

    // Build matching maps from priced products
    const siblingMap = new Map<string, number>()
    const handingMap = new Map<string, number[]>()
    const coreKeyMap = new Map<string, number[]>()

    for (const p of pricedProducts) {
      // Sibling map (first wins)
      const bk = getBaseKey(p.name)
      if (!siblingMap.has(bk)) siblingMap.set(bk, p.basePrice)

      // Handing-agnostic map
      const hk = getHandingAgnosticKey(p.name)
      if (!handingMap.has(hk)) handingMap.set(hk, [])
      handingMap.get(hk)!.push(p.basePrice)

      // Core-key map
      const ck = getCoreKey(p.name)
      if (ck) {
        if (!coreKeyMap.has(ck)) coreKeyMap.set(ck, [])
        coreKeyMap.get(ck)!.push(p.basePrice)
      }
    }

    const updates: PriceUpdate[] = []
    const noMatch: { sku: string; name: string; category: string }[] = []

    for (const product of zeroProducts) {
      const result = findPrice(product, csvMap, siblingMap, handingMap, coreKeyMap)
      if (result) {
        updates.push(result)
      } else {
        noMatch.push({ sku: product.sku, name: product.name, category: product.category })
      }
    }

    // Summary by source
    const bySource: Record<string, number> = {}
    for (const u of updates) {
      const key = u.source.replace(/\(.*\)/g, '').replace(/\d+ /g, 'N ').trim()
      bySource[key] = (bySource[key] || 0) + 1
    }

    const noMatchByCat: Record<string, number> = {}
    for (const nm of noMatch) {
      noMatchByCat[nm.category] = (noMatchByCat[nm.category] || 0) + 1
    }

    return NextResponse.json({
      mode: 'preview',
      summary: {
        totalZeroPriced: zeroProducts.length,
        canFix: updates.length,
        noMatch: noMatch.length,
        bySource,
      },
      noMatchByCategory: Object.entries(noMatchByCat)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => ({ category: cat, count })),
      sampleUpdates: updates.slice(0, 30).map(u => ({
        sku: u.sku,
        name: u.name,
        category: u.category,
        newPrice: u.newPrice,
        source: u.source,
      })),
      sampleNoMatch: noMatch.slice(0, 20),
    })
  } catch (error) {
    console.error('Pricing preview failed:', error)
    return NextResponse.json(
      { error: 'Pricing preview failed', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Product', undefined, { method: 'POST' }).catch(() => {})

    const csvMap = loadCSVPricing()

    const zeroProducts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name", "category", "basePrice"
       FROM "Product"
       WHERE "active" = true AND "basePrice" = 0`
    )
    const pricedProducts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name", "category", "basePrice"
       FROM "Product"
       WHERE "active" = true AND "basePrice" > 0`
    )

    const siblingMap = new Map<string, number>()
    const handingMap = new Map<string, number[]>()
    const coreKeyMap = new Map<string, number[]>()

    for (const p of pricedProducts) {
      const bk = getBaseKey(p.name)
      if (!siblingMap.has(bk)) siblingMap.set(bk, p.basePrice)

      const hk = getHandingAgnosticKey(p.name)
      if (!handingMap.has(hk)) handingMap.set(hk, [])
      handingMap.get(hk)!.push(p.basePrice)

      const ck = getCoreKey(p.name)
      if (ck) {
        if (!coreKeyMap.has(ck)) coreKeyMap.set(ck, [])
        coreKeyMap.get(ck)!.push(p.basePrice)
      }
    }

    const updates: { id: string; newPrice: number; source: string }[] = []

    for (const product of zeroProducts) {
      const result = findPrice(product, csvMap, siblingMap, handingMap, coreKeyMap)
      if (result) {
        updates.push({ id: result.id, newPrice: result.newPrice, source: result.source })
      }
    }

    // Apply in batches using raw SQL
    let applied = 0
    const batchSize = 50
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize)
      await Promise.all(batch.map(u =>
        prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "basePrice" = $1 WHERE "id" = $2`,
          u.newPrice, u.id
        )
      ))
      applied += batch.length
    }

    const bySource: Record<string, number> = {}
    for (const u of updates) {
      const key = u.source.replace(/\(.*\)/g, '').replace(/\d+ /g, 'N ').trim()
      bySource[key] = (bySource[key] || 0) + 1
    }

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Product" WHERE "active" = true AND "basePrice" = 0`
    )
    const remainingZero = countResult[0]?.cnt || 0

    return NextResponse.json({
      mode: 'applied',
      totalUpdated: applied,
      bySource,
      remainingZeroPriced: remainingZero,
    })
  } catch (error) {
    console.error('Pricing update failed:', error)
    return NextResponse.json(
      { error: 'Pricing update failed', details: String(error) },
      { status: 500 }
    )
  }
}
