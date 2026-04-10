export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ─── Product Description Generator ─────────────────────────────────
// Generates human-readable descriptions from product name + attributes
// Run via POST /api/admin/products/enrich to enrich all products

function generateDescription(product: any): string {
  const parts: string[] = []
  const name = product.name || ''
  const cat = product.category || ''
  const sub = product.subcategory || ''

  // Determine the product type for the opening sentence
  const isExterior = /exterior|ext\b/i.test(cat) || /exterior/i.test(name)
  const isInterior = /interior|int\b/i.test(cat) || (!isExterior && /door/i.test(cat))
  const isDoor = /door/i.test(cat) || /door/i.test(name)
  const isSlab = /slab/i.test(cat) || /slab/i.test(name)
  const isFrame = /frame|jamb/i.test(cat)
  const isTrim = /trim|casing|base/i.test(cat)
  const isHardware = /hardware/i.test(cat)
  const isBifold = /bifold/i.test(name)
  const isFireRated = /fire/i.test(cat) || product.fireRating
  const isAttic = /attic/i.test(cat)
  const isPatio = /patio|sliding.*glass/i.test(cat)
  const isGarage = /garage/i.test(cat)
  const isHVAC = /hvac/i.test(cat)
  const isStair = /stair/i.test(cat)
  const isGlass = /glass|lite/i.test(cat)
  const isDunnage = /dunnage/i.test(cat)

  if (isAttic) { parts.push('Attic access door panel') }
  else if (isPatio) { parts.push('Patio or sliding glass door unit') }
  else if (isGarage) { parts.push('Garage-to-house fire-rated door') }
  else if (isHVAC) { parts.push('HVAC access door') }
  else if (isDunnage) { parts.push('Dunnage door' + (isSlab ? ' slab' : ' unit') + ' for production bundling') }
  else if (isGlass) { parts.push('Glass or lite insert panel') }
  else if (isStair) { parts.push('Stair component') }
  else if (isFrame) { parts.push((isExterior ? 'Exterior' : 'Interior') + ' door frame') }
  else if (isTrim) { parts.push('Trim or molding piece') }
  else if (isHardware) { parts.push('Door hardware') }
  else if (isDoor && isSlab) { parts.push((isExterior ? 'Exterior' : 'Interior') + ' door slab (no frame)') }
  else if (isDoor && isBifold) { parts.push('Bifold door unit') }
  else if (isDoor) { parts.push((isExterior ? 'Exterior' : 'Interior') + ' pre-hung door unit') }
  else { parts.push(cat || 'Building material product') }

  if (product.coreType) {
    const core = product.coreType.toLowerCase()
    if (core.includes('hollow')) { parts.push('with hollow core construction (lightweight, ideal for interior closets and bedrooms)') }
    else if (core.includes('solid')) { parts.push('with solid core construction (heavier, better sound insulation and durability)') }
  }
  if (product.panelStyle) { parts.push(`featuring ${product.panelStyle} panel design`) }
  if (product.doorSize) {
    const size = product.doorSize
    const match = size.match(/^(\d)(\d)(\d)(\d)$/)
    if (match) {
      const w = `${match[1]}'${match[2]}"`
      const h = `${match[3]}'${match[4]}"`
      parts.push(`in size ${w} x ${h} (${size})`)
    } else {
      parts.push(`in size ${size}`)
    }
  }
  if (product.handing) {
    const h = product.handing.toUpperCase()
    const handMap: Record<string, string> = { 'LH': 'left-hand swing', 'RH': 'right-hand swing', 'LHIS': 'left-hand inswing', 'RHIS': 'right-hand inswing', 'LHOS': 'left-hand outswing', 'RHOS': 'right-hand outswing' }
    parts.push(`with ${handMap[h] || h}`)
  }
  if (product.jambSize) { parts.push(`fitted with ${product.jambSize}" jamb`) }
  if (product.material) { parts.push(`constructed from ${product.material}`) }
  if (product.hardwareFinish) {
    const finishMap: Record<string, string> = { 'SN': 'Satin Nickel', 'BLK': 'Matte Black', 'ORB': 'Oil-Rubbed Bronze', 'BRS': 'Brass', 'CHR': 'Chrome', 'AB': 'Antique Brass' }
    parts.push(`with ${finishMap[product.hardwareFinish] || product.hardwareFinish} finish hardware`)
  }
  if (product.fireRating) { parts.push(`rated for ${product.fireRating} fire resistance`) }
  else if (isFireRated) { parts.push('with fire-rated construction') }
  if (sub && !parts.some(p => p.toLowerCase().includes(sub.toLowerCase()))) { parts.push(`(${sub})`) }

  let desc = parts.join(', ').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
  desc = desc.charAt(0).toUpperCase() + desc.slice(1)
  if (!desc.endsWith('.')) desc += '.'
  return desc
}

// POST: Enrich all products with generated descriptions
export async function POST(request: NextRequest) {
  // SECURITY: Require staff auth
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get('dryRun') === 'true'
    const onlyEmpty = searchParams.get('onlyEmpty') !== 'false'

    // Fetch all products that need enrichment
    let products: any[]
    if (onlyEmpty) {
      products = await prisma.$queryRawUnsafe(
        `SELECT "id", "sku", "name", "category", "subcategory", "doorSize", "handing",
                "coreType", "panelStyle", "jambSize", "casingCode", "hardwareFinish",
                "material", "fireRating", "description"
         FROM "Product"
         WHERE "active" = true AND ("description" IS NULL OR "description" = '')`
      )
    } else {
      products = await prisma.$queryRawUnsafe(
        `SELECT "id", "sku", "name", "category", "subcategory", "doorSize", "handing",
                "coreType", "panelStyle", "jambSize", "casingCode", "hardwareFinish",
                "material", "fireRating", "description"
         FROM "Product"
         WHERE "active" = true`
      )
    }

    if (dryRun) {
      const samples = products.slice(0, 20).map(p => ({
        sku: p.sku,
        name: p.name,
        category: p.category,
        generatedDescription: generateDescription(p),
      }))
      return NextResponse.json({
        message: 'Dry run -- no changes made',
        totalToEnrich: products.length,
        samples,
      })
    }

    // Batch update descriptions using raw SQL
    let updated = 0
    const batchSize = 100
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize)
      await Promise.all(
        batch.map(p =>
          prisma.$executeRawUnsafe(
            `UPDATE "Product" SET "description" = $1 WHERE "id" = $2`,
            generateDescription(p),
            p.id
          )
        )
      )
      updated += batch.length
    }

    return NextResponse.json({
      message: `Enriched ${updated} products with generated descriptions`,
      updated,
      total: products.length,
    })
  } catch (error: any) {
    console.error('Product enrichment error:', error)
    return NextResponse.json(
      { error: 'Failed to enrich products' },
      { status: 500 }
    )
  }
}

// GET: Check enrichment status
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int AS "total",
         COUNT(CASE WHEN "description" IS NOT NULL AND "description" != '' THEN 1 END)::int AS "withDesc",
         COUNT(CASE WHEN "description" IS NULL OR "description" = '' THEN 1 END)::int AS "withoutDesc"
       FROM "Product"
       WHERE "active" = true`
    )
    const { total, withDesc, withoutDesc } = stats[0] || { total: 0, withDesc: 0, withoutDesc: 0 }

    return NextResponse.json({
      total,
      withDescriptions: withDesc,
      withoutDescriptions: withoutDesc,
      percentComplete: total > 0 ? ((withDesc / total) * 100).toFixed(1) + '%' : '0%',
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
