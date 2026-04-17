export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ParsedProduct {
  doorSize?: string
  sizeWidth?: string
  sizeHeight?: string
  handing?: string
  material?: string
  panelStyle?: string
  coreType?: string
  jambSize?: string
  casing?: string
  hardwareFinish?: string
  isDoubleDoor?: boolean
  astrType?: string // Twin/T-AST, Twin/BC, etc.
  isPreHung: boolean
  isSlab: boolean
  isExterior: boolean
  isBifold: boolean
  isAtticDoor: boolean
  isBarnDoor: boolean
  isServiceDoor: boolean
  isFireRated: boolean
  fireRating?: string
  isThreshold: boolean
  isTrim: boolean
  isTollBrothers: boolean
  isThermaRu: boolean
  thermaRuModel?: string
  other?: string[]
}

interface EnrichmentResult {
  productId: string
  sku: string
  name: string
  displayName: string
  description: string
  styleKey: string
  parsed: ParsedProduct
  category: string
  subcategory?: string
}

// ============================================================================
// PARSING LOGIC
// ============================================================================

function parseProductName(name: string, category: string): ParsedProduct {
  const result: ParsedProduct = {
    isPreHung: false,
    isSlab: false,
    isExterior: false,
    isBifold: false,
    isAtticDoor: false,
    isBarnDoor: false,
    isServiceDoor: false,
    isFireRated: false,
    isThreshold: false,
    isTrim: false,
    isTollBrothers: false,
    isThermaRu: false,
    other: [],
  }

  const upper = name.toUpperCase()

  // Detect product types by category and name content
  result.isPreHung = category.includes('ADT') || upper.startsWith('ADT ') || upper.includes('PRE-HUNG') || upper.includes('PREHUNG')
  result.isSlab = category.includes('SLAB') || upper.includes('SLAB ONLY')
  result.isExterior = category.includes('EXTERIOR') || upper.includes('EXTERIOR')
  result.isAtticDoor = category.includes('ATTIC') || upper.includes('ATTIC')
  result.isBarnDoor = category.includes('BARN') || upper.includes('BARN DOOR')
  result.isServiceDoor = category.includes('SERVICE') || upper.includes('SERVICE DOOR')
  result.isThreshold = category.includes('THRESHOLD') || upper.includes('THRESHOLD')
  result.isTrim = category.includes('TRIM')
  result.isBifold = upper.includes('BIFOLD')
  result.isFireRated = category.includes('FIRE') || upper.includes('FIRE DOOR') || upper.includes('20 MIN') || upper.includes('45 MIN') || upper.includes('90 MIN')
  result.isTollBrothers = upper.includes('TOLL BROTHERS') || upper.includes('TB ')
  result.isThermaRu = upper.includes('THERMA-TRU')

  // Extract fire rating
  if (result.isFireRated) {
    if (upper.includes('90 MIN')) result.fireRating = '90-min'
    else if (upper.includes('45 MIN')) result.fireRating = '45-min'
    else if (upper.includes('20 MIN')) result.fireRating = '20-min'
  }

  // Parse Therma-Tru model (e.g., "CCW906L", "S100")
  if (result.isThermaRu) {
    const thermaMatch = upper.match(/\b([A-Z]+\d+[A-Z]?)\b/)
    if (thermaMatch) {
      result.thermaRuModel = thermaMatch[1]
    }
  }

  // Extract door size codes (e.g., 2468, 3068, 2868, 2480, 3080, 4068)
  const sizeMatch = name.match(/\b(\d{2})(\d{2})\b/)
  if (sizeMatch) {
    const width = sizeMatch[1]
    const height = sizeMatch[2]
    result.doorSize = `${width}${height}`
    result.sizeWidth = `${width}"`
    result.sizeHeight = height === '68' ? '68"' : height === '80' ? '80"' : `${height}"`
  }

  // Parse handing
  const handMatch = upper.match(/\b(LH|RH|LHIS|RHIS|LHS|RHS)\b/)
  if (handMatch) {
    result.handing = handMatch[1]
  }

  // Parse material
  const materials = ['PINE', 'MDF', 'PRIMED', 'CLEAR PINE', 'KNOTTY ALDER', 'HEMLOCK', 'OAK', 'MAHOGANY', 'FIBERGLASS', 'STEEL', 'WALNUT']
  for (const material of materials) {
    if (upper.includes(material)) {
      result.material = material
      break
    }
  }

  // Parse panel/style info
  const styleMatch = upper.match(/\b(\d+\s*(?:LITE|LT)|SHAKER|FLUSH|FLAT|LOUVER|FRENCH|BIFOLD|BARN)\b/)
  if (styleMatch) {
    let style = styleMatch[1].toUpperCase()
    style = style.replace(/\s+/g, ' ').trim()
    if (style.includes('LITE') || style.includes('LT')) {
      const liteMatch = style.match(/(\d+)/)
      if (liteMatch) {
        result.panelStyle = `${liteMatch[1]}-Lite`
      }
    } else if (style.includes('PANEL')) {
      const panelMatch = style.match(/(\d+)/)
      if (panelMatch) {
        result.panelStyle = `${panelMatch[1]}-Panel`
      }
    } else {
      result.panelStyle = style.charAt(0) + style.substring(1).toLowerCase()
    }
  }

  // Parse panel count from common abbreviations
  if (!result.panelStyle) {
    if (upper.includes('6 PNL') || upper.includes('6PNL')) result.panelStyle = '6-Panel'
    else if (upper.includes('2 PNL') || upper.includes('2PNL')) result.panelStyle = '2-Panel'
    else if (upper.includes('SHAKER')) result.panelStyle = 'Shaker'
    else if (upper.includes('FLUSH')) result.panelStyle = 'Flush'
    else if (upper.includes('FLAT')) result.panelStyle = 'Flat'
    else if (upper.includes('1 LITE') || upper.includes('1LITE')) result.panelStyle = '1-Lite'
    else if (upper.includes('10 LITE') || upper.includes('10LITE')) result.panelStyle = '10-Lite'
    else if (upper.includes('15 LITE') || upper.includes('15LITE')) result.panelStyle = '15-Lite'
    else if (upper.includes('LOUVER')) result.panelStyle = 'Louver'
  }

  // Parse core type
  if (upper.includes('H/C') || upper.includes('HOLLOW')) {
    result.coreType = 'Hollow Core'
  } else if (upper.includes('S/C') || upper.includes('SOLID')) {
    result.coreType = 'Solid Core'
  }

  // Parse jamb size
  if (upper.includes('6-5/8') || upper.includes('6 5/8') || upper.includes('6.625')) {
    result.jambSize = '6-5/8"'
  } else if (upper.includes('4-5/8') || upper.includes('4 5/8') || upper.includes('4.625')) {
    result.jambSize = '4-5/8"'
  }

  // Parse casing
  if (upper.includes('A-COL 2-1/4')) {
    result.casing = 'A-Colonial 2-1/4"'
  } else if (upper.includes('A-COL')) {
    result.casing = 'A-Colonial'
  } else if (upper.includes('C-322') || upper.includes('C322')) {
    result.casing = 'Colonial 322'
  } else if (upper.includes('NO CASE') || upper.includes('NOCASE')) {
    result.casing = 'No Casing'
  }

  // Parse hardware finish
  if (upper.includes('BLK') || upper.includes('BLACK')) {
    result.hardwareFinish = 'Black'
  } else if (upper.includes('SN') || upper.includes('SATIN NICKEL')) {
    result.hardwareFinish = 'Satin Nickel'
  } else if (upper.includes('ORB') || upper.includes('OIL RUBBED BRONZE')) {
    result.hardwareFinish = 'Oil Rubbed Bronze'
  }

  // Detect double doors / twin configuration
  if (upper.includes('TWIN/T-AST') || upper.includes('TWIN/TAST')) {
    result.isDoubleDoor = true
    result.astrType = 'T-Astragal'
  } else if (upper.includes('TWIN/BC')) {
    result.isDoubleDoor = true
    result.astrType = 'Boise Cascade'
  } else if (upper.includes('TWIN') || upper.includes('DOUBLE')) {
    result.isDoubleDoor = true
  }

  // Collect other attributes found in the name for reference
  const foundTokens: string[] = []
  if (upper.includes('PRIMED')) foundTokens.push('Primed')
  if (upper.includes('CLEAR')) foundTokens.push('Clear')
  if (upper.includes('HINGES')) foundTokens.push('Hinges')

  result.other = foundTokens

  return result
}

// ============================================================================
// ENRICHMENT LOGIC
// ============================================================================

function generateDisplayName(parsed: ParsedProduct, category: string): string {
  // Build a catalog-style product name: "[Material] [Style] [Type] - [Size] [Handing]"
  // e.g. "Pine 1-Lite Pre-Hung Interior Door - 24×80 Left Hand"
  //      "Therma-Tru S100 Fiberglass Exterior Door"
  //      "MDF 5-Panel Shaker Solid Core Interior Door - 30×80 Right Hand"

  const nameParts: string[] = []
  let doorType = ''
  let size = ''
  let handing = ''

  // Material first (for wood species emphasis)
  if (parsed.material && !parsed.isThermaRu) {
    const matTitle = parsed.material.charAt(0).toUpperCase() + parsed.material.slice(1).toLowerCase()
    nameParts.push(matTitle)
  }

  // Panel style
  if (parsed.panelStyle && !parsed.isAtticDoor && !parsed.isBarnDoor && !parsed.isServiceDoor) {
    nameParts.push(parsed.panelStyle)
  }

  // Core type
  if (parsed.coreType) {
    nameParts.push(parsed.coreType)
  }

  // Door type
  if (parsed.isThermaRu) {
    doorType = `Therma-Tru ${parsed.thermaRuModel || ''} Fiberglass Exterior Door`
  } else if (parsed.isFireRated) {
    const rating = parsed.fireRating ? `${parsed.fireRating} ` : ''
    doorType = `${rating}Fire-Rated Door`
  } else if (parsed.isAtticDoor) {
    doorType = 'Attic Access Door'
  } else if (parsed.isBarnDoor) {
    doorType = 'Barn Door'
  } else if (parsed.isServiceDoor) {
    doorType = parsed.material === 'STEEL' ? 'Steel Service Door' : 'Service Door'
  } else if (parsed.isThreshold) {
    doorType = parsed.material ? `${parsed.material} Threshold` : 'Threshold'
  } else if (parsed.isTrim) {
    doorType = parsed.material ? `${parsed.material} Trim` : 'Trim'
  } else if (parsed.isBifold) {
    doorType = 'Bifold Door'
  } else if (parsed.isExterior || category.includes('EXTERIOR')) {
    doorType = parsed.isPreHung ? 'Pre-Hung Exterior Door' : 'Exterior Door'
  } else if (parsed.isSlab) {
    doorType = 'Interior Door Slab'
  } else {
    if (parsed.isDoubleDoor) {
      doorType = parsed.isPreHung ? 'Double Pre-Hung Interior Door' : 'Double Interior Door'
    } else {
      doorType = parsed.isPreHung ? 'Pre-Hung Interior Door' : 'Interior Door'
    }
  }

  // Size
  if (parsed.sizeWidth && parsed.sizeHeight) {
    const width = parseInt(parsed.sizeWidth)
    const height = parseInt(parsed.sizeHeight)
    size = `${width}×${height}`
  }

  // Handing
  if (parsed.handing) {
    const handingMap: Record<string, string> = {
      LH: 'Left Hand',
      RH: 'Right Hand',
      LHIS: 'Left Hand Inswing',
      RHIS: 'Right Hand Inswing',
    }
    handing = handingMap[parsed.handing] || parsed.handing
  }

  // Assemble: [material+style parts] [door type] - [size] [handing]
  let result = ''
  if (parsed.isThermaRu || parsed.isThreshold || parsed.isTrim) {
    result = doorType
  } else {
    const prefix = nameParts.filter(Boolean).join(' ')
    result = prefix ? `${prefix} ${doorType}` : doorType
  }

  // Append size and handing after dash
  const suffix = [size, handing].filter(Boolean).join(' ')
  if (suffix) {
    result += ` — ${suffix}`
  }

  return result.trim()
}

function generateDescription(
  name: string,
  parsed: ParsedProduct,
  category: string,
  displayName: string
): string {
  const lines: string[] = []

  // First line: summary of what it is
  if (parsed.isThermaRu) {
    lines.push(`Therma-Tru fiberglass exterior door. Model ${parsed.thermaRuModel || 'not specified'}.`)
  } else if (parsed.isFireRated) {
    const ratingStr = parsed.fireRating ? `${parsed.fireRating} fire-rated` : 'Fire-rated'
    if (parsed.panelStyle) {
      lines.push(`${ratingStr} ${parsed.panelStyle.toLowerCase()} door.`)
    } else {
      lines.push(`${ratingStr} door.`)
    }
  } else if (parsed.isAtticDoor) {
    lines.push('Attic access door.')
  } else if (parsed.isBarnDoor) {
    lines.push('Barn style sliding door.')
  } else if (parsed.isServiceDoor) {
    lines.push('Service door (pass-through).')
  } else if (parsed.isThreshold) {
    lines.push('Door threshold for transition between rooms.')
  } else if (parsed.isTrim) {
    lines.push('Trim component for door and window installations.')
  } else if (parsed.isBifold) {
    lines.push(`Bifold door system${parsed.material ? ` in ${parsed.material.toLowerCase()}` : ''}.`)
  } else if (parsed.isExterior || category.includes('EXTERIOR')) {
    if (parsed.panelStyle) {
      lines.push(
        `Pre-hung ${parsed.panelStyle.toLowerCase()} exterior door${parsed.material ? ` in ${parsed.material.toLowerCase()}` : ''}.`
      )
    } else {
      lines.push(`Pre-hung exterior door${parsed.material ? ` in ${parsed.material.toLowerCase()}` : ''}.`)
    }
  } else {
    // Interior door
    let typeStr = ''
    if (parsed.panelStyle) typeStr = parsed.panelStyle.toLowerCase()
    if (parsed.coreType) {
      const coreStr = parsed.coreType.toLowerCase()
      typeStr = typeStr ? `${typeStr} ${coreStr}` : coreStr
    }

    if (parsed.isPreHung || !parsed.isSlab) {
      lines.push(`Pre-hung${typeStr ? ` ${typeStr}` : ''} interior door${parsed.material ? ` in ${parsed.material.toLowerCase()}` : ''}.`)
    } else {
      lines.push(`Door slab${typeStr ? ` (${typeStr})` : ''}${parsed.material ? ` in ${parsed.material.toLowerCase()}` : ''}.`)
    }
  }

  // Dimensions
  if (parsed.sizeWidth && parsed.sizeHeight) {
    const width = parseInt(parsed.sizeWidth)
    const height = parseInt(parsed.sizeHeight)
    const widthFt = Math.floor(width / 12)
    const widthIn = width % 12
    const heightFt = Math.floor(height / 12)
    const heightIn = height % 12
    lines.push(`${width}" × ${height}" (${widthFt}'${widthIn}" × ${heightFt}'${heightIn}").`)
  }

  // Handing
  if (parsed.handing) {
    const handingMap: Record<string, string> = {
      LH: 'Left hand swing',
      RH: 'Right hand swing',
      LHIS: 'Left hand inswing',
      RHIS: 'Right hand inswing',
    }
    lines.push(handingMap[parsed.handing] || `${parsed.handing} swing.`)
  }

  // Material/finish details
  if (parsed.material) {
    if (parsed.material.toUpperCase().includes('PRIMED')) {
      lines.push('Primed finish ready for paint.')
    } else if (parsed.material.toUpperCase().includes('PINE') || parsed.material.toUpperCase().includes('CLEAR')) {
      lines.push('Unfinished — ready for stain or paint.')
    } else if (parsed.material.toUpperCase().includes('MDF')) {
      lines.push(`${parsed.material} construction, primed and ready for paint.`)
    }
  }

  // Jamb and casing
  const jambCasing: string[] = []
  if (parsed.jambSize) jambCasing.push(`${parsed.jambSize} jamb`)
  if (parsed.casing) jambCasing.push(`${parsed.casing} casing`)
  if (jambCasing.length > 0) {
    lines.push(`${jambCasing.join(' with ')} included.`)
  }

  // Hardware
  if (parsed.hardwareFinish) {
    lines.push(`${parsed.hardwareFinish} hinges.`)
  }

  // Double door / astragal
  if (parsed.isDoubleDoor && parsed.astrType) {
    lines.push(`Includes ${parsed.astrType.toLowerCase()} for double-door swing.`)
  }

  // Manufacturing note
  if (!parsed.isSlab && !parsed.isThreshold && !parsed.isTrim && !parsed.isThermaRu) {
    lines.push('Manufactured and assembled by Abel Door & Trim.')
  }

  return lines.join(' ')
}

function generateStyleKey(parsed: ParsedProduct, category: string): string {
  const parts: string[] = []

  // Base style
  if (parsed.isThermaRu) {
    parts.push('thermatru')
    if (parsed.thermaRuModel) parts.push(parsed.thermaRuModel.toLowerCase())
  } else if (parsed.isFireRated) {
    parts.push('fire-rated')
    if (parsed.fireRating) parts.push(parsed.fireRating)
  } else if (parsed.isAtticDoor) {
    parts.push('attic-door')
  } else if (parsed.isBarnDoor) {
    parts.push('barn-door')
  } else if (parsed.isServiceDoor) {
    parts.push('service-door')
  } else if (parsed.isThreshold) {
    parts.push('threshold')
  } else if (parsed.isTrim) {
    parts.push('trim')
  } else if (parsed.isBifold) {
    parts.push('bifold')
  } else if (parsed.isExterior || category.includes('EXTERIOR')) {
    parts.push('exterior')
    if (parsed.panelStyle) parts.push(parsed.panelStyle.toLowerCase().replace(/-/g, ''))
  } else {
    // Interior
    parts.push('interior')
    if (parsed.isDoubleDoor) parts.push('double')
    if (parsed.panelStyle) parts.push(parsed.panelStyle.toLowerCase().replace(/-/g, ''))
    if (parsed.coreType) {
      const coreStr = parsed.coreType === 'Hollow Core' ? 'hc' : 'sc'
      parts.push(coreStr)
    }
  }

  // Material
  if (parsed.material) {
    parts.push(parsed.material.toLowerCase().replace(/\s+/g, ''))
  }

  return parts.filter(Boolean).join('-')
}

// ============================================================================
// BATCH UPDATE HELPER
// ============================================================================

interface ProductUpdate {
  id: string
  description: string
  doorSize?: string
  handing?: string
  coreType?: string
  panelStyle?: string
  jambSize?: string
  casingCode?: string
  hardwareFinish?: string
  material?: string
  fireRating?: string
  imageAlt?: string
  subcategory?: string
}

async function batchUpdateProducts(
  updates: ProductUpdate[]
): Promise<number> {
  const batchSize = 50
  let updated = 0

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    const promises = batch.map(({ id, description, doorSize, handing, coreType, panelStyle, jambSize, casingCode, hardwareFinish, material, fireRating, imageAlt, subcategory }) => {
      // Build dynamic SET clause based on provided fields
      const setClauses: string[] = []
      const values: any[] = []
      let paramIndex = 1

      if (description !== undefined) {
        setClauses.push(`"description" = $${paramIndex}`)
        values.push(description)
        paramIndex++
      }
      if (doorSize !== undefined) {
        setClauses.push(`"doorSize" = $${paramIndex}`)
        values.push(doorSize)
        paramIndex++
      }
      if (handing !== undefined) {
        setClauses.push(`"handing" = $${paramIndex}`)
        values.push(handing)
        paramIndex++
      }
      if (coreType !== undefined) {
        setClauses.push(`"coreType" = $${paramIndex}`)
        values.push(coreType)
        paramIndex++
      }
      if (panelStyle !== undefined) {
        setClauses.push(`"panelStyle" = $${paramIndex}`)
        values.push(panelStyle)
        paramIndex++
      }
      if (jambSize !== undefined) {
        setClauses.push(`"jambSize" = $${paramIndex}`)
        values.push(jambSize)
        paramIndex++
      }
      if (casingCode !== undefined) {
        setClauses.push(`"casingCode" = $${paramIndex}`)
        values.push(casingCode)
        paramIndex++
      }
      if (hardwareFinish !== undefined) {
        setClauses.push(`"hardwareFinish" = $${paramIndex}`)
        values.push(hardwareFinish)
        paramIndex++
      }
      if (material !== undefined) {
        setClauses.push(`"material" = $${paramIndex}`)
        values.push(material)
        paramIndex++
      }
      if (fireRating !== undefined) {
        setClauses.push(`"fireRating" = $${paramIndex}`)
        values.push(fireRating)
        paramIndex++
      }
      if (imageAlt !== undefined) {
        setClauses.push(`"imageAlt" = $${paramIndex}`)
        values.push(imageAlt)
        paramIndex++
      }
      if (subcategory !== undefined) {
        setClauses.push(`"subcategory" = $${paramIndex}`)
        values.push(subcategory)
        paramIndex++
      }

      // Always add id as last parameter
      setClauses.push(`"updatedAt" = NOW()`)
      values.push(id)

      const setClause = setClauses.join(', ')
      const sql = `UPDATE "Product" SET ${setClause} WHERE id = $${paramIndex}`

      return prisma.$executeRawUnsafe(sql, ...values)
    })
    await Promise.all(promises)
    updated += batch.length
  }

  return updated
}

// ============================================================================
// API HANDLERS
// ============================================================================

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const category = searchParams.get('category')

    // Build where clause
    let whereClause = 'WHERE "active" = true'
    const params: any[] = []
    let paramIndex = 1

    if (category) {
      whereClause += ` AND "category" = $${paramIndex}`
      params.push(category)
      paramIndex++
    }

    // Fetch products for dry run
    const sql = `
      SELECT "id", "name", "sku", "category", "subcategory", "active"
      FROM "Product"
      ${whereClause}
      ORDER BY "category" ASC, "name" ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `
    params.push(limit, offset)

    const products = await prisma.$queryRawUnsafe(sql, ...params)

    // Count total
    const countSql = `
      SELECT COUNT(*)::int as count
      FROM "Product"
      ${whereClause}
    `
    const countParams = category ? [category] : []
    const countResult = await prisma.$queryRawUnsafe(countSql, ...countParams)
    const total = (countResult as any[])[0]?.count || 0

    // Generate enrichments for review
    const enrichments: EnrichmentResult[] = (products as any[]).map((product: any) => {
      const parsed = parseProductName(product.name, product.category)
      const displayName = generateDisplayName(parsed, product.category)
      const description = generateDescription(
        product.name,
        parsed,
        product.category,
        displayName
      )
      const styleKey = generateStyleKey(parsed, product.category)

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        displayName,
        description,
        styleKey,
        parsed,
        category: product.category,
        subcategory: product.subcategory,
      }
    })

    return NextResponse.json({
      mode: 'dry-run',
      totalProducts: total,
      enrichments,
      pagination: {
        offset,
        limit,
        total,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('Enrich dry-run failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
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

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const dryRun = searchParams.get('dryRun') === 'true'

    // Fetch ALL products (or filtered by category)
    let whereClause = 'WHERE "active" = true'
    const params: any[] = []

    if (category) {
      whereClause += ` AND "category" = $1`
      params.push(category)
    }

    const sql = `
      SELECT "id", "name", "sku", "category", "subcategory", "active"
      FROM "Product"
      ${whereClause}
      ORDER BY "category" ASC, "name" ASC
    `

    const allProducts = await prisma.$queryRawUnsafe(sql, ...params)

    // console.log(`Enriching ${(allProducts as any[]).length} products...`)

    // Generate enrichments
    const enrichments: EnrichmentResult[] = []
    const updates: ProductUpdate[] = []

    for (const product of (allProducts as any[])) {
      const parsed = parseProductName(product.name, product.category)
      const displayName = generateDisplayName(parsed, product.category)
      const description = generateDescription(
        product.name,
        parsed,
        product.category,
        displayName
      )
      const styleKey = generateStyleKey(parsed, product.category)

      const enrichment: EnrichmentResult = {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        displayName,
        description,
        styleKey,
        parsed,
        category: product.category,
        subcategory: product.subcategory,
      }

      enrichments.push(enrichment)

      // Build full update with all parsed attributes
      const update: ProductUpdate = {
        id: product.id,
        description,
        imageAlt: displayName,
      }
      if (parsed.doorSize) update.doorSize = parsed.doorSize
      if (parsed.handing) update.handing = parsed.handing
      if (parsed.coreType) update.coreType = parsed.coreType
      if (parsed.panelStyle) update.panelStyle = parsed.panelStyle
      if (parsed.jambSize) update.jambSize = parsed.jambSize
      if (parsed.casing) update.casingCode = parsed.casing
      if (parsed.hardwareFinish) update.hardwareFinish = parsed.hardwareFinish
      if (parsed.material) update.material = parsed.material
      if (parsed.fireRating) update.fireRating = parsed.fireRating

      // Set subcategory based on type
      if (parsed.isPreHung && !product.subcategory) {
        update.subcategory = parsed.isExterior ? 'Pre-Hung Exterior' : 'Pre-Hung Interior'
      } else if (parsed.isSlab && !product.subcategory) {
        update.subcategory = 'Slab Only'
      } else if (parsed.isBifold && !product.subcategory) {
        update.subcategory = 'Bifold'
      } else if (parsed.isAtticDoor && !product.subcategory) {
        update.subcategory = 'Attic Access'
      }

      updates.push(update)
    }

    // Apply updates if not dry run
    let updateCount = 0
    if (!dryRun) {
      updateCount = await batchUpdateProducts(updates)
      // console.log(`Updated ${updateCount} products with descriptions`)

      // Update displayName via raw SQL (column added outside Prisma migration)
      const displayNameBatchSize = 50
      for (let i = 0; i < enrichments.length; i += displayNameBatchSize) {
        const batch = enrichments.slice(i, i + displayNameBatchSize)
        const promises = batch.map((e) =>
          prisma.$executeRawUnsafe(
            `UPDATE "Product" SET "displayName" = $1 WHERE id = $2`,
            e.displayName,
            e.productId
          )
        )
        await Promise.all(promises)
      }
      // console.log(`Updated ${enrichments.length} products with displayNames`)
    }

    // Summary by category
    const byCategory: Record<string, number> = {}
    for (const enrichment of enrichments) {
      byCategory[enrichment.category] = (byCategory[enrichment.category] || 0) + 1
    }

    // Sample enrichments for review
    const samples = enrichments.slice(0, 5)

    return NextResponse.json({
      mode: dryRun ? 'dry-run' : 'applied',
      totalProcessed: enrichments.length,
      totalUpdated: updateCount,
      byCategory,
      samples,
      message: dryRun
        ? 'Dry run complete. Review above samples and call POST without dryRun=true to apply all updates.'
        : `Successfully enriched and updated ${updateCount} products with descriptions and style mappings.`,
    })
  } catch (error) {
    console.error('Enrich POST failed:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
