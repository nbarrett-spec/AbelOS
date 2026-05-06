export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { maybeCreatePriceChangeRequest } from '@/lib/price-change-detector'

// CSV parsing utility - handles BOM and quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // Skip next quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

function readCSV(filePath: string): { headers: string[]; rows: Record<string, string>[] } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  let content = fs.readFileSync(filePath, 'utf-8')

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1)
  }

  // Split into logical lines handling quoted fields that span multiple lines
  const logicalLines: string[] = []
  let currentLine = ''
  let inQuotes = false

  for (const rawLine of content.split('\n')) {
    if (!currentLine && !rawLine.trim()) continue

    if (currentLine) {
      currentLine += '\n' + rawLine
    } else {
      currentLine = rawLine
    }

    // Count unescaped quotes to determine if we're inside a quoted field
    for (let i = (currentLine.length - rawLine.length - (currentLine.length > rawLine.length ? 1 : 0)); i < currentLine.length; i++) {
      if (i < 0) i = 0
      if (currentLine[i] === '"') inQuotes = !inQuotes
    }

    if (!inQuotes) {
      if (currentLine.trim()) logicalLines.push(currentLine)
      currentLine = ''
    }
  }
  if (currentLine.trim()) logicalLines.push(currentLine)

  if (logicalLines.length === 0) return { headers: [], rows: [] }

  const headers = parseCSVLine(logicalLines[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < logicalLines.length; i++) {
    const values = parseCSVLine(logicalLines[i])
    // Skip rows that have far too few or too many columns (likely corrupted)
    if (values.length < headers.length / 2) continue
    const row: Record<string, string> = {}

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || ''
    }

    rows.push(row)
  }

  return { headers, rows }
}

function generateVendorCode(name: string): string {
  let code = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase()
  if (!code) code = 'VND'
  return code
}

function mapPaymentTerm(term: string): string {
  if (!term) return 'NET_15'
  const t = term.toLowerCase().trim()
  if (t.includes('pay at order') || t.includes('cod')) return 'PAY_AT_ORDER'
  if (t.includes('delivery')) return 'PAY_ON_DELIVERY'
  if (t.includes('due on receipt')) return 'PAY_ON_DELIVERY'
  if (t.includes('net 30')) return 'NET_30'
  if (t.includes('net 15')) return 'NET_15'
  return 'NET_15'
}

function generateEmailSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') + '@builder.abellumber.com'
}

// Hash a default password for new builder accounts
async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 64, (err, buf) => {
      if (err) resolve('')
      resolve(`${salt}:${buf.toString('hex')}`)
    })
  })
}

// Parse product name to extract attributes
function parseProductAttributes(productName: string) {
  const attrs: any = {
    doorSize: null,
    handing: null,
    coreType: null,
    panelStyle: null,
    hardwareFinish: null,
    material: null,
    fireRating: null,
  }

  if (!productName) return attrs
  const name = productName.toUpperCase()

  // Door size: 2068, 2868, 3068, etc.
  const sizeMatch = name.match(/(\d{4})/)
  if (sizeMatch) attrs.doorSize = sizeMatch[1]

  // Handing
  if (/(^|[\s])LHIS([\s]|$)/.test(name)) attrs.handing = 'LHIS'
  else if (/(^|[\s])RHIS([\s]|$)/.test(name)) attrs.handing = 'RHIS'
  else if (/(^|[\s])LH([\s]|$)/.test(name)) attrs.handing = 'LH'
  else if (/(^|[\s])RH([\s]|$)/.test(name)) attrs.handing = 'RH'

  // Core type
  if (/H\/C|HOLLOW[\s]?CORE/.test(name)) attrs.coreType = 'Hollow Core'
  else if (/S\/C|SOLID[\s]?CORE/.test(name)) attrs.coreType = 'Solid Core'

  // Panel style
  if (/1[\s-]?PNL|1[\s-]?PANEL/.test(name)) attrs.panelStyle = '1-Panel'
  else if (/2[\s-]?PNL|2[\s-]?PANEL/.test(name)) attrs.panelStyle = '2-Panel'
  else if (/6[\s-]?PNL|6[\s-]?PANEL/.test(name)) attrs.panelStyle = '6-Panel'
  else if (/SHAKER/.test(name)) attrs.panelStyle = 'Shaker'
  else if (/FLAT/.test(name)) attrs.panelStyle = 'Flat'

  // Hardware finish
  if (/\bSN\b|SATIN NICKEL/.test(name)) attrs.hardwareFinish = 'SN'
  else if (/\bBLK\b|BLACK/.test(name)) attrs.hardwareFinish = 'BLK'
  else if (/\bORB\b|OIL RUBBED BRONZE/.test(name)) attrs.hardwareFinish = 'ORB'
  else if (/\bCHROME\b/.test(name)) attrs.hardwareFinish = 'Chrome'

  // Material
  if (/PINE/.test(name)) attrs.material = 'Pine'
  else if (/MDF|MEDIUM DENSITY/.test(name)) attrs.material = 'MDF'
  else if (/ALDER|KNOTTY ALDER/.test(name)) attrs.material = 'Knotty Alder'
  else if (/MAHOGANY/.test(name)) attrs.material = 'Mahogany'
  else if (/PRIMED/.test(name)) attrs.material = 'Primed'

  // Fire rating
  if (/20[\s]?MIN/.test(name)) attrs.fireRating = '20min'
  else if (/45[\s]?MIN/.test(name)) attrs.fireRating = '45min'
  else if (/90[\s]?MIN/.test(name)) attrs.fireRating = '90min'

  return attrs
}

// Known builder pricing columns in the ProductDetails CSV
const BUILDER_PRICING_COLUMNS = [
  'AGD', 'BROOKFIELD', 'CROSS CUSTOM', 'Country Road Homebuilders',
  'FIG TREE HOMES', 'Imagination Homes', 'JOSEPH PAUL HOMES',
  'Pulte ', 'RDR Developement', 'Shaddock Homes', 'TOLL BROTHERS',
]

// ─── IMPORT FUNCTIONS ────────────────────────────────────────────────────

async function importProducts(csvPath: string) {
  const { headers, rows } = readCSV(csvPath)
  let imported = 0
  let skipped = 0
  let pricingCreated = 0
  const errors: string[] = []

  // Build builder name → ID map for custom pricing
  const builders = await prisma.builder.findMany({
    select: { id: true, companyName: true },
  })
  const builderMap = new Map<string, string>()
  for (const b of builders) {
    builderMap.set(b.companyName.toUpperCase(), b.id)
  }

  for (const row of rows) {
    try {
      const sku = row['SKU']?.trim()
      if (!sku) { skipped++; continue }

      const name = row['ProductName']?.trim() || sku
      const category = (row['Category']?.trim() || 'Uncategorized').replace(/_/g, ' ')
      const basePrice = parseFloat(row['DefaultUnitPrice'] || '0') || 0
      const cost = parseFloat(row['Cost'] || '0') || 0
      const vendorPrice = parseFloat(row['VendorPrice'] || '0') || 0
      const isActive = row['IsActive']?.trim() !== 'False'
      const attrs = parseProductAttributes(name)

      // Effective new cost picks the same fallback chain the upsert below uses.
      const effectiveNewCost = cost || vendorPrice || 0

      // Snapshot pre-update cost (only matters when SKU already exists).
      // Cheap when it doesn't — Prisma returns null and the detector skips.
      const priorProduct = await prisma.product.findUnique({
        where: { sku },
        select: { id: true, cost: true },
      })

      const product = await prisma.product.upsert({
        where: { sku },
        update: {
          name,
          category,
          basePrice,
          cost: cost || vendorPrice || 0,
          active: isActive,
          ...attrs,
          inflowCategory: row['Category']?.trim(),
          lastSyncedAt: new Date(),
        },
        create: {
          sku,
          name,
          category,
          basePrice,
          cost: cost || vendorPrice || 0,
          active: isActive,
          ...attrs,
          inflowCategory: row['Category']?.trim(),
        },
      })

      // If this was an existing SKU and the cost moved, queue for review.
      // First-fill (priorProduct == null) skips inside the detector via the
      // no-baseline-cost branch.
      if (priorProduct && effectiveNewCost > 0) {
        maybeCreatePriceChangeRequest({
          productId: product.id,
          oldCost: priorProduct.cost ?? 0,
          newCost: effectiveNewCost,
          source: 'inflow-import',
        }).catch(() => {})
      }

      // Import per-builder pricing
      for (const col of BUILDER_PRICING_COLUMNS) {
        const price = parseFloat(row[col] || '0')
        if (price > 0) {
          // Find matching builder
          const builderName = col.trim().toUpperCase()
          let builderId: string | undefined

          // Try exact match first, then partial
          for (const [name, id] of builderMap) {
            if (name === builderName || name.includes(builderName) || builderName.includes(name)) {
              builderId = id
              break
            }
          }

          if (builderId) {
            try {
              await prisma.builderPricing.upsert({
                where: {
                  builderId_productId: { builderId, productId: product.id },
                },
                update: { customPrice: price },
                create: {
                  builderId,
                  productId: product.id,
                  customPrice: price,
                },
              })
              pricingCreated++
            } catch {
              // Skip pricing errors silently
            }
          }
        }
      }

      imported++
    } catch (err: any) {
      errors.push(`SKU ${row['SKU']}: ${err.message}`)
    }
  }

  return { imported, skipped, pricingCreated, errors: errors.slice(0, 20) }
}

async function importVendors(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []

  // Build existing vendor lookup by name (case-insensitive)
  const existingVendors = await prisma.vendor.findMany({ select: { id: true, code: true, name: true } })
  const vendorByName = new Map<string, { id: string; code: string }>()
  const vendorCodes = new Set<string>()
  for (const v of existingVendors) {
    vendorByName.set(v.name.toLowerCase(), { id: v.id, code: v.code })
    vendorCodes.add(v.code)
  }

  for (const row of rows) {
    try {
      const name = row['Name']?.trim()
      if (!name) { skipped++; continue }

      // Validate: skip rows where the "name" looks like corrupted CSV data
      if (name.length > 200 || name.includes(',No Tax,') || name === 'True' || name === 'False') {
        skipped++
        continue
      }

      const isActive = row['IsActive']?.trim() !== 'False'
      const vendorData = {
        name,
        contactName: row['ContactName']?.trim() || null,
        email: row['Email']?.trim() || null,
        phone: row['Phone']?.trim() || null,
        address: [row['Address1'], row['City'], row['State'], row['PostalCode']].filter(Boolean).join(', ') || null,
        active: isActive,
      }

      // Check if vendor already exists by name
      const existing = vendorByName.get(name.toLowerCase())
      if (existing) {
        await prisma.vendor.update({
          where: { id: existing.id },
          data: vendorData,
        })
        updated++
      } else {
        // Generate unique code for new vendor
        let code = generateVendorCode(name)
        let attempt = 0
        while (vendorCodes.has(code) && attempt < 100) {
          attempt++
          code = generateVendorCode(name) + attempt
        }
        vendorCodes.add(code)

        const created = await prisma.vendor.create({
          data: { code, ...vendorData },
        })
        vendorByName.set(name.toLowerCase(), { id: created.id, code })
        imported++
      }
    } catch (err: any) {
      errors.push(`${row['Name'] || 'Unknown'}: ${err.message}`)
    }
  }

  return { imported, updated, skipped, errors: errors.slice(0, 20) }
}

async function importCustomers(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []

  const defaultHash = await hashPassword('Abel2026!')

  for (const row of rows) {
    try {
      const name = row['Name']?.trim()
      if (!name) { skipped++; continue }

      const isActive = row['IsActive']?.trim() !== 'False'
      const email = row['Email']?.trim() || generateEmailSlug(name)
      const paymentTerm = mapPaymentTerm(row['DefaultPaymentTerms']?.trim() || '')
      const discount = parseFloat(row['Discount'] || '0') || 0
      const taxExempt = row['TaxingScheme']?.trim()?.toLowerCase()?.includes('exempt') || false

      // Check if builder already exists
      const existing = await prisma.builder.findUnique({ where: { email } })

      if (existing) {
        await prisma.builder.update({
          where: { email },
          data: {
            companyName: name,
            contactName: row['ContactName']?.trim() || existing.contactName,
            phone: row['Phone']?.trim() || existing.phone,
            paymentTerm: paymentTerm as any,
            taxExempt,
            status: isActive ? 'ACTIVE' : 'SUSPENDED',
          },
        })
        updated++
      } else {
        await prisma.builder.create({
          data: {
            companyName: name,
            email,
            contactName: row['ContactName']?.trim() || name,
            phone: row['Phone']?.trim() || '',
            passwordHash: defaultHash,
            paymentTerm: paymentTerm as any,
            taxExempt,
            status: isActive ? 'ACTIVE' : 'PENDING',
          },
        })
        imported++
      }
    } catch (err: any) {
      errors.push(`${row['Name'] || 'Unknown'}: ${err.message}`)
    }
  }

  return { imported, updated, skipped, errors: errors.slice(0, 20) }
}

async function importStockLevels(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  for (const row of rows) {
    try {
      const sku = row['SKU']?.trim()
      const quantity = Math.round(parseFloat(row['Quantity']?.trim() || '0'))
      const location = row['Location']?.trim() || null
      const sublocation = row['Sublocation']?.trim() || null

      if (!sku || !skuMap.has(sku)) { skipped++; continue }

      const productId = skuMap.get(sku)!

      await prisma.inventoryItem.upsert({
        where: { productId },
        update: {
          onHand: quantity,
          available: quantity,
          warehouseZone: sublocation || undefined,
          lastCountedAt: new Date(),
        },
        create: {
          productId,
          onHand: quantity,
          available: quantity,
          warehouseZone: location || undefined,
          binLocation: sublocation || undefined,
        },
      })

      imported++
    } catch (err: any) {
      errors.push(`SKU ${row['SKU']}: ${err.message}`)
    }
  }

  return { imported, skipped, errors: errors.slice(0, 20) }
}

async function importVendorProducts(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  // Get all vendors
  const vendors = await prisma.vendor.findMany({ select: { id: true, name: true } })
  if (vendors.length === 0) {
    return { imported: 0, skipped: rows.length, errors: ['No vendors in database. Import vendors first.'] }
  }

  // Also update product cost from vendor pricing
  for (const row of rows) {
    try {
      const sku = row['SKU']?.trim()
      if (!sku || !skuMap.has(sku)) { skipped++; continue }

      const productId = skuMap.get(sku)!
      const vendorSku = row['VendorProductCode']?.trim() || sku
      const vendorPrice = parseFloat(row['VendorPrice']?.trim() || '0')
      const leadTimeDays = parseInt(row['LeadTimeDays']?.trim() || '0') || undefined
      const productName = row['Product']?.trim()

      // Use first vendor as default (the CSV doesn't specify which vendor)
      const vendorId = vendors[0].id

      await prisma.vendorProduct.upsert({
        where: { vendorId_productId: { vendorId, productId } },
        update: {
          vendorSku,
          vendorCost: vendorPrice || undefined,
          leadTimeDays,
          vendorName: productName || undefined,
        },
        create: {
          vendorId,
          productId,
          vendorSku,
          vendorName: productName || undefined,
          vendorCost: vendorPrice || undefined,
          leadTimeDays,
        },
      })

      // Update product cost if vendor provides one
      if (vendorPrice > 0) {
        // Snapshot prior cost so the detector can decide if this move is
        // material. Selecting only `cost` is cheap and avoids racing with
        // the row we're about to update.
        const prior = await prisma.product.findUnique({
          where: { id: productId },
          select: { cost: true },
        })
        await prisma.product.update({
          where: { id: productId },
          data: { cost: vendorPrice },
        })
        // Fire-and-forget — never block the cost write on review-queue logic.
        maybeCreatePriceChangeRequest({
          productId,
          oldCost: prior?.cost ?? 0,
          newCost: vendorPrice,
          source: 'inflow-import',
        }).catch(() => {})
      }

      imported++
    } catch (err: any) {
      errors.push(`SKU ${row['SKU']}: ${err.message}`)
    }
  }

  return { imported, skipped, errors: errors.slice(0, 20) }
}

async function importBOM(csvPath: string) {
  const { headers, rows } = readCSV(csvPath)
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  const products = await prisma.product.findMany({ select: { id: true, name: true } })
  const nameMap = new Map(products.map(p => [p.name.toLowerCase().trim(), p.id]))

  // Group by parent product
  const byParent = new Map<string, typeof rows>()
  for (const row of rows) {
    const parentName = row[headers[0]]?.trim()
    if (parentName) {
      if (!byParent.has(parentName)) byParent.set(parentName, [])
      byParent.get(parentName)!.push(row)
    }
  }

  for (const [parentName, entries] of byParent) {
    const parentId = nameMap.get(parentName.toLowerCase().trim())
    if (!parentId) { skipped += entries.length; continue }

    for (const row of entries) {
      try {
        const componentName = row[headers[1]]?.trim()
        if (!componentName) { skipped++; continue }

        const componentId = nameMap.get(componentName.toLowerCase().trim())
        if (!componentId) { skipped++; continue }

        const quantity = parseFloat(row[headers[2]]?.trim() || '1') || 1
        const componentType = row[headers[3]]?.trim() || null

        await prisma.bomEntry.create({
          data: { parentId, componentId, quantity, componentType },
        })

        imported++
      } catch (err: any) {
        if (!err.message.includes('Unique constraint')) {
          errors.push(`BOM: ${err.message}`)
        }
        skipped++
      }
    }
  }

  return { imported, skipped, errors: errors.slice(0, 20) }
}

async function importPurchaseOrders(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let ordersCreated = 0
  let itemsCreated = 0
  let skipped = 0
  const errors: string[] = []

  // Build vendor name → ID map (deduplicate: use first ID per name)
  const vendors = await prisma.vendor.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
  const vendorMap = new Map<string, string>()
  for (const v of vendors) {
    const key = v.name.toLowerCase()
    if (!vendorMap.has(key)) vendorMap.set(key, v.id)
  }

  // Build SKU → product ID map
  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  // Get first staff member for createdById
  const staff = await prisma.staff.findFirst({ where: { role: 'PROJECT_MANAGER' } })
  if (!staff) {
    return { ordersCreated: 0, itemsCreated: 0, skipped: rows.length, errors: ['No staff found'] }
  }

  // Group rows by OrderNumber
  const orderGroups = new Map<string, typeof rows>()
  for (const row of rows) {
    const orderNum = row['OrderNumber']?.trim()
    if (!orderNum) continue
    if (!orderGroups.has(orderNum)) orderGroups.set(orderNum, [])
    orderGroups.get(orderNum)!.push(row)
  }

  for (const [orderNum, orderRows] of orderGroups) {
    try {
      const firstRow = orderRows[0]
      const vendorName = firstRow['Vendor']?.trim()
      const isQuote = firstRow['IsQuote']?.trim() === 'True'
      const isCancelled = firstRow['IsCancelled']?.trim() === 'True'

      if (isQuote || isCancelled) { skipped++; continue }

      // Find vendor
      let vendorId: string | undefined
      if (vendorName) {
        for (const [name, id] of vendorMap) {
          if (name === vendorName.toLowerCase() || name.includes(vendorName.toLowerCase().substring(0, 8))) {
            vendorId = id
            break
          }
        }
      }

      if (!vendorId) { skipped++; continue }

      // Map InFlow status to our POStatus enum
      const invStatus = firstRow['InventoryStatus']?.trim() || ''
      const payStatus = firstRow['PaymentStatus']?.trim() || ''
      let status = 'SENT_TO_VENDOR'
      if (invStatus === 'Fulfilled') status = 'RECEIVED'
      else if (invStatus === 'Partially Fulfilled') status = 'PARTIALLY_RECEIVED'
      else if (invStatus === 'Unfulfilled' && payStatus === 'Unpaid') status = 'SENT_TO_VENDOR'

      // Parse dates
      const orderDate = firstRow['OrderDate'] ? new Date(firstRow['OrderDate'].trim()) : new Date()
      const dueDate = firstRow['DueDate'] ? new Date(firstRow['DueDate'].trim()) : undefined

      // Check if PO already exists
      const existingPO = await prisma.purchaseOrder.findUnique({ where: { poNumber: orderNum } })
      if (existingPO) { skipped++; continue }

      // Build line items from rows that have product data
      const lineItems: any[] = []
      let subtotal = 0

      for (const row of orderRows) {
        const productSku = row['ProductSKU']?.trim()
        const productName = row['ProductName']?.trim()
        if (!productName && !productSku) continue

        const qty = parseFloat(row['ProductQuantity'] || '1') || 1
        const unitCost = parseFloat(row['ProductUnitPrice'] || '0') || 0
        const lineTotal = parseFloat(row['ProductSubtotal'] || '0') || qty * unitCost

        lineItems.push({
          productId: productSku ? (skuMap.get(productSku) || null) : null,
          vendorSku: row['VendorProductCode']?.trim() || productSku || '',
          description: productName || productSku || 'Unknown item',
          quantity: qty,
          unitCost,
          lineTotal,
        })

        subtotal += lineTotal
      }

      if (lineItems.length === 0) { skipped++; continue }

      const freight = parseFloat(firstRow['Freight'] || '0') || 0

      await prisma.purchaseOrder.create({
        data: {
          poNumber: orderNum,
          vendorId,
          createdById: staff.id,
          status: status as any,
          subtotal,
          shippingCost: freight,
          total: subtotal + freight,
          orderedAt: orderDate,
          expectedDate: dueDate || undefined,
          receivedAt: status === 'RECEIVED' ? new Date() : undefined,
          notes: firstRow['OrderRemarks']?.trim() || null,
          items: {
            create: lineItems,
          },
        },
      })

      ordersCreated++
      itemsCreated += lineItems.length
    } catch (err: any) {
      errors.push(`PO ${orderNum}: ${err.message}`)
    }
  }

  return { ordersCreated, itemsCreated, skipped, errors: errors.slice(0, 20) }
}

// ─── SALES ORDER IMPORT ─────────────────────────────────────────────────

async function importSalesOrders(csvPath: string) {
  const { rows } = readCSV(csvPath)
  let ordersCreated = 0
  let ordersUpdated = 0
  let itemsCreated = 0
  let skipped = 0
  const errors: string[] = []

  // Build customer name → builder ID map (case-insensitive)
  const builders = await prisma.builder.findMany({ select: { id: true, companyName: true }, orderBy: { createdAt: 'asc' } })
  const builderMap = new Map<string, string>()
  for (const b of builders) {
    const key = b.companyName.toLowerCase()
    if (!builderMap.has(key)) builderMap.set(key, b.id)
  }

  // Build SKU → product ID map
  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  // Group rows by OrderNumber
  const orderGroups = new Map<string, typeof rows>()
  for (const row of rows) {
    const orderNum = row['OrderNumber']?.trim()
    if (!orderNum) continue
    if (!orderGroups.has(orderNum)) orderGroups.set(orderNum, [])
    orderGroups.get(orderNum)!.push(row)
  }

  for (const [orderNum, orderRows] of orderGroups) {
    try {
      const firstRow = orderRows[0]
      const customerName = firstRow['Customer']?.trim()
      const isQuote = firstRow['IsQuote']?.trim() === 'True'
      const isCancelled = firstRow['IsCancelled']?.trim() === 'True'

      if (isQuote || isCancelled) { skipped++; continue }

      // Find builder by customer name
      let builderId: string | undefined
      if (customerName) {
        // Try exact match first
        builderId = builderMap.get(customerName.toLowerCase())
        // Try partial match if not found
        if (!builderId) {
          const custLower = customerName.toLowerCase()
          for (const [name, id] of builderMap) {
            if (name.includes(custLower) || custLower.includes(name)) {
              builderId = id
              break
            }
          }
        }
      }

      if (!builderId) {
        errors.push(`SO ${orderNum}: Customer "${customerName}" not found in builders`)
        skipped++
        continue
      }

      // Map InFlow status → OrderStatus
      const invStatus = firstRow['InventoryStatus']?.trim() || ''
      const payStatus = firstRow['PaymentStatus']?.trim() || ''
      let orderStatus: string = 'RECEIVED'
      if (invStatus === 'Fulfilled') orderStatus = 'DELIVERED'
      else if (invStatus === 'Partially Fulfilled') orderStatus = 'IN_PRODUCTION'
      else if (invStatus === 'Started') orderStatus = 'CONFIRMED'
      else if (invStatus === 'Unfulfilled') orderStatus = 'RECEIVED'

      // Map InFlow payment status → PaymentStatus
      let paymentStatus: string = 'PENDING'
      if (payStatus === 'Paid') paymentStatus = 'PAID'
      else if (payStatus === 'Invoiced') paymentStatus = 'INVOICED'
      else if (payStatus === 'Partially Paid') paymentStatus = 'INVOICED'
      else if (payStatus === 'Unpaid') paymentStatus = 'PENDING'

      // Parse dates
      const orderDate = firstRow['OrderDate'] ? new Date(firstRow['OrderDate'].trim()) : new Date()
      const invoicedDate = firstRow['InvoicedDate']?.trim() ? new Date(firstRow['InvoicedDate'].trim()) : undefined
      const dueDate = firstRow['DueDate']?.trim() ? new Date(firstRow['DueDate'].trim()) : undefined
      const datePaid = firstRow['DatePaid']?.trim() ? new Date(firstRow['DatePaid'].trim()) : undefined

      // Map payment terms
      const payTerms = firstRow['PaymentTerms']?.trim() || ''
      let paymentTerm = mapPaymentTerm(payTerms)

      // Parse amount paid
      const amountPaidStr = firstRow['AmountPaid']?.replace(/[^0-9.-]/g, '') || '0'
      const amountPaid = parseFloat(amountPaidStr) || 0

      // Build line items
      const lineItems: any[] = []
      let subtotal = 0

      for (const row of orderRows) {
        const productSku = row['ProductSKU']?.trim()
        const productName = row['ProductName']?.trim()
        if (!productName && !productSku) continue

        const qty = Math.round(parseFloat(row['ProductQuantity'] || '1') || 1)
        const unitPrice = parseFloat(row['ProductUnitPrice'] || '0') || 0
        // Fix: ProductSubtotal of "0" or empty should fall back to qty * unitPrice
        const rawSubtotal = parseFloat(row['ProductSubtotal'] || '')
        const lineTotal = (rawSubtotal > 0) ? rawSubtotal : qty * unitPrice

        const productId = productSku ? (skuMap.get(productSku) || null) : null

        lineItems.push({
          productId: productId || undefined,
          description: productName || productSku || 'Unknown item',
          quantity: qty,
          unitPrice,
          lineTotal,
        })

        subtotal += lineTotal
      }

      if (lineItems.length === 0) { skipped++; continue }

      // Calculate tax
      const taxRate = parseFloat(firstRow['Tax1Rate'] || '0') || 0
      const taxAmount = subtotal * (taxRate / 100)
      const freight = parseFloat(firstRow['Freight'] || '0') || 0
      const total = subtotal + taxAmount + freight

      // Check if order already exists (upsert pattern)
      const existingOrder = await prisma.order.findUnique({ where: { orderNumber: orderNum } })

      if (existingOrder) {
        // Update existing order status and payment info
        await prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            status: orderStatus as any,
            paymentStatus: paymentStatus as any,
            paidAt: datePaid || undefined,
            dueDate: dueDate || undefined,
          },
        })
        ordersUpdated++
      } else {
        // Filter out items without a valid productId (required FK)
        const validItems = lineItems.filter((item: any) => item.productId)
        const skippedItems = lineItems.length - validItems.length

        if (validItems.length === 0) {
          errors.push(`SO ${orderNum}: No line items matched products in catalog (${lineItems.length} items had unknown SKUs)`)
          skipped++
          continue
        }

        await prisma.order.create({
          data: {
            builderId,
            orderNumber: orderNum,
            poNumber: firstRow['PONumber']?.trim() || null,
            subtotal,
            taxAmount,
            shippingCost: freight,
            total,
            paymentTerm: paymentTerm as any,
            paymentStatus: paymentStatus as any,
            paidAt: datePaid || undefined,
            dueDate: dueDate || undefined,
            status: orderStatus as any,
            deliveryDate: invStatus === 'Fulfilled' ? (invoicedDate || orderDate) : undefined,
            deliveryNotes: firstRow['ShippingAddressRemarks']?.trim() || firstRow['Delivery Location']?.trim() || null,
            items: {
              create: validItems,
            },
            createdAt: orderDate,
          },
        })

        ordersCreated++
        itemsCreated += validItems.length
        if (skippedItems > 0) {
          errors.push(`SO ${orderNum}: ${skippedItems} items skipped (unknown SKUs)`)
        }
      }
    } catch (err: any) {
      errors.push(`SO ${orderNum}: ${err.message?.substring(0, 100)}`)
    }
  }

  return {
    ordersCreated,
    ordersUpdated,
    itemsCreated,
    skipped,
    totalOrdersInFile: orderGroups.size,
    errors: errors.slice(0, 30),
  }
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { importType = 'all' } = body

    const validTypes = ['products', 'vendors', 'customers', 'stock', 'bom', 'vendor-products', 'purchase-orders', 'sales-orders', 'all']
    if (!validTypes.includes(importType)) {
      return NextResponse.json({ error: `Invalid importType. Must be one of: ${validTypes.join(', ')}` }, { status: 400 })
    }
    audit(request, `IMPORT_INFLOW_${String(importType).toUpperCase()}`, 'InflowImport', undefined, { importType }, 'WARN').catch(() => {})

    // Resolve InFlow exports directory relative to project root
    const baseDir = path.resolve(process.cwd(), '..', 'In Flow Exports')
    if (!fs.existsSync(baseDir)) {
      return NextResponse.json({
        error: `InFlow exports directory not found at: ${baseDir}`,
        hint: 'Place your InFlow CSV exports in the "In Flow Exports" folder next to the project directory',
      }, { status: 404 })
    }

    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      importType,
      baseDir,
    }

    // ORDER MATTERS: Vendors → Customers → Products → Stock → VendorProducts → BOM → POs

    if (importType === 'vendors' || importType === 'all') {
      try {
        results.vendors = await importVendors(path.join(baseDir, 'inFlow_Vendor (4).csv'))
      } catch (err: any) { results.vendors = { error: err.message } }
    }

    if (importType === 'customers' || importType === 'all') {
      try {
        results.customers = await importCustomers(path.join(baseDir, 'inFlow_Customer (4).csv'))
      } catch (err: any) { results.customers = { error: err.message } }
    }

    if (importType === 'products' || importType === 'all') {
      try {
        results.products = await importProducts(path.join(baseDir, 'inFlow_ProductDetails (10).csv'))
      } catch (err: any) { results.products = { error: err.message } }
    }

    if (importType === 'stock' || importType === 'all') {
      try {
        results.stock = await importStockLevels(path.join(baseDir, 'inFlow_StockLevels (8).csv'))
      } catch (err: any) { results.stock = { error: err.message } }
    }

    if (importType === 'vendor-products' || importType === 'all') {
      try {
        results.vendorProducts = await importVendorProducts(path.join(baseDir, 'inFlow_VendorProductDetails.csv'))
      } catch (err: any) { results.vendorProducts = { error: err.message } }
    }

    if (importType === 'bom' || importType === 'all') {
      try {
        results.bom = await importBOM(path.join(baseDir, 'inFlow_BOM (7).csv'))
      } catch (err: any) { results.bom = { error: err.message } }
    }

    if (importType === 'purchase-orders' || importType === 'all') {
      try {
        results.purchaseOrders = await importPurchaseOrders(path.join(baseDir, 'inFlow_PurchaseOrder (7).csv'))
      } catch (err: any) { results.purchaseOrders = { error: err.message } }
    }

    if (importType === 'sales-orders') {
      try {
        // Sales order CSV is in Downloads folder or provided via csvPath in body
        const downloadsDir = path.resolve(process.cwd(), '..', 'Downlods')
        const salesCsvPath = body.csvPath || path.join(downloadsDir, 'inFlow_SalesOrder (15).csv')
        results.salesOrders = await importSalesOrders(salesCsvPath)
      } catch (err: any) { results.salesOrders = { error: err.message } }
    }

    return NextResponse.json({ success: true, message: 'InFlow data import completed', ...results })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'Import failed' }, { status: 500 })
  }
}

// ─── CLEANUP HANDLER (PATCH) ─────────────────────────────────────────────
// Deduplicates vendors, removes corrupted records, and reassigns PO references

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const results: Record<string, any> = { timestamp: new Date().toISOString() }
    audit(request, 'INFLOW_CLEANUP', 'Database', undefined, { note: 'vendor/po dedupe' }, 'WARN').catch(() => {})

    // 1. Remove corrupted vendor records (CSV parsing artifacts)
    const corruptedVendors = await prisma.vendor.findMany({
      where: {
        OR: [
          { name: { contains: ',No Tax,' } },
          { name: { in: ['True', 'False', '.,True', '.,False'] } },
          { name: { startsWith: '469-' } }, // Phone numbers as names
        ],
      },
      select: { id: true, name: true },
    })

    // Move POs from corrupted vendors to null or skip
    for (const cv of corruptedVendors) {
      await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { vendorId: cv.id } } })
      await prisma.purchaseOrder.deleteMany({ where: { vendorId: cv.id } })
      await prisma.vendorProduct.deleteMany({ where: { vendorId: cv.id } })
      await prisma.vendor.delete({ where: { id: cv.id } })
    }
    results.corruptedRemoved = corruptedVendors.length

    // 2. Deduplicate vendors - keep the one with the most PO references (or oldest)
    const allVendors = await prisma.vendor.findMany({
      select: { id: true, name: true, code: true, createdAt: true, _count: { select: { purchaseOrders: true } } },
      orderBy: { createdAt: 'asc' },
    })

    const vendorGroups = new Map<string, typeof allVendors>()
    for (const v of allVendors) {
      const key = v.name.toLowerCase()
      if (!vendorGroups.has(key)) vendorGroups.set(key, [])
      vendorGroups.get(key)!.push(v)
    }

    let deduped = 0
    let posReassigned = 0

    for (const [, group] of vendorGroups) {
      if (group.length <= 1) continue

      // Keep the vendor with the most POs, or the oldest
      group.sort((a, b) => (b._count.purchaseOrders - a._count.purchaseOrders) || (a.createdAt.getTime() - b.createdAt.getTime()))
      const keeper = group[0]
      const duplicates = group.slice(1)

      for (const dup of duplicates) {
        // Reassign POs from duplicate to keeper
        const reassigned = await prisma.purchaseOrder.updateMany({
          where: { vendorId: dup.id },
          data: { vendorId: keeper.id },
        })
        posReassigned += reassigned.count

        // Reassign or remove vendor products
        try {
          await prisma.vendorProduct.deleteMany({ where: { vendorId: dup.id } })
        } catch { /* ignore constraint errors */ }

        // Delete the duplicate vendor
        await prisma.vendor.delete({ where: { id: dup.id } })
        deduped++
      }
    }

    results.vendorsDeduped = deduped
    results.posReassigned = posReassigned

    // 3. Count remaining vendors
    const remaining = await prisma.vendor.count()
    results.vendorsRemaining = remaining

    return NextResponse.json({ success: true, message: 'Cleanup completed', ...results })
  } catch (error: any) {
    console.error('PATCH cleanup error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error'}, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  return NextResponse.json({
    message: 'POST to /api/ops/import-inflow with { importType } in body. PATCH to deduplicate and clean data.',
    importTypes: ['products', 'vendors', 'customers', 'stock', 'bom', 'vendor-products', 'purchase-orders', 'all'],
    order: 'When running "all", imports execute in dependency order: vendors → customers → products → stock → vendor-products → bom → purchase-orders',
  })
}
