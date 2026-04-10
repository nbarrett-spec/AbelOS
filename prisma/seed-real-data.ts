/**
 * Real Data Seed Script
 *
 * Imports Abel's actual catalog data from Excel files into the database:
 * - 2,852 products from Abel_Catalog_CLEAN.xlsx
 * - 7,416 BOM entries
 * - 95 builder accounts with payment terms
 * - 945 builder-specific pricing entries
 *
 * Usage:
 *   npx tsx prisma/seed-real-data.ts
 *
 * Requires: npm install xlsx (already in package.json)
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'path'
import * as fs from 'fs'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Resolve Excel file paths — try multiple locations for Windows compatibility
function findExcelFiles(): { catalogFile: string; liveFile: string } {
  const projectRoot = process.cwd()
  const parentDir = path.resolve(projectRoot, '..')

  // Candidate locations to search
  const candidates = [
    parentDir,                                    // ../  (Abel Lumber folder)
    projectRoot,                                  // same folder as project
    path.resolve(projectRoot, '..', '..'),        // two levels up
  ]

  console.log(`\nSearching for Excel files...`)
  console.log(`  Working directory: ${projectRoot}`)

  for (const dir of candidates) {
    const catalog = path.join(dir, 'Abel_Catalog_CLEAN.xlsx')
    const live = path.join(dir, 'Abel_Product_Catalog_LIVE.xlsx')

    console.log(`  Checking: ${dir}`)
    console.log(`    Catalog: ${fs.existsSync(catalog) ? 'FOUND' : 'not found'}`)
    console.log(`    Live:    ${fs.existsSync(live) ? 'FOUND' : 'not found'}`)

    if (fs.existsSync(catalog)) {
      console.log(`\n  Using files from: ${dir}`)
      return { catalogFile: catalog, liveFile: live }
    }
  }

  // Fallback — use parent dir path even if not found (will error on read)
  console.error('\n  WARNING: Excel files not found in any expected location!')
  console.error('  Make sure Abel_Catalog_CLEAN.xlsx and Abel_Product_Catalog_LIVE.xlsx')
  console.error('  are in the same folder as the abel-builder-platform project folder.')
  return {
    catalogFile: path.join(parentDir, 'Abel_Catalog_CLEAN.xlsx'),
    liveFile: path.join(parentDir, 'Abel_Product_Catalog_LIVE.xlsx'),
  }
}

const { catalogFile: CATALOG_FILE, liveFile: LIVE_FILE } = findExcelFiles()

function readSheet(filePath: string, sheetName: string): Record<string, any>[] {
  console.log(`   Reading sheet "${sheetName}" from ${path.basename(filePath)}...`)

  if (!fs.existsSync(filePath)) {
    console.error(`   ERROR: File not found: ${filePath}`)
    return []
  }

  const wb = XLSX.readFile(filePath)

  // Try exact match first
  let ws = wb.Sheets[sheetName]

  // If not found, try fuzzy match (handles encoding differences with em dash, etc.)
  if (!ws) {
    const available = wb.SheetNames
    console.log(`   Available sheets: ${available.join(', ')}`)

    // Try matching by removing special characters
    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim()
    const target = normalize(sheetName)

    const match = available.find(name => normalize(name) === target)
    if (match) {
      console.log(`   Fuzzy matched "${sheetName}" -> "${match}"`)
      ws = wb.Sheets[match]
    }
  }

  if (!ws) {
    console.warn(`   Sheet "${sheetName}" not found in ${filePath}`)
    console.warn(`   Available sheets: ${wb.SheetNames.join(', ')}`)
    return []
  }

  const data = XLSX.utils.sheet_to_json(ws, { defval: null })
  console.log(`   Read ${data.length} rows`)
  return data
}

// Map payment term strings from InFlow to our enum
function mapPaymentTerm(term: string | null): string {
  if (!term) return 'NET_15'
  const t = term.toLowerCase().trim()
  if (t.includes('receipt') || t.includes('order') || t.includes('cod')) return 'PAY_ON_DELIVERY'
  if (t.includes('net 30') || t.includes('net30')) return 'NET_30'
  if (t.includes('net 15') || t.includes('net15')) return 'NET_15'
  return 'NET_15'
}

async function seedProducts() {
  console.log('\n📦 Importing products from Abel_Catalog_CLEAN.xlsx...')

  const rows = readSheet(CATALOG_FILE, 'Product Master — Clean')
  console.log(`   Found ${rows.length} products`)

  let created = 0
  let skipped = 0

  for (const row of rows) {
    const sku = row['SKU']
    if (!sku) { skipped++; continue }

    const cost = parseFloat(row['Unit Cost']) || 0
    const price = parseFloat(row['Default List Price']) || 0

    try {
      await prisma.product.upsert({
        where: { sku },
        update: {
          name: row['Product Name'] || sku,
          category: row['Clean Category'] || 'Uncategorized',
          subcategory: row['Product Type'] || null,
          cost,
          basePrice: price,
          doorSize: row['Door Size'] || null,
          handing: row['Handing'] || null,
          coreType: row['Core Type'] || null,
          panelStyle: row['Panel Style'] || null,
          jambSize: row['Jamb Size'] || null,
          casingCode: row['Casing'] || null,
          hardwareFinish: row['Hardware Finish'] || null,
          material: row['Material'] || null,
          fireRating: row['Fire Rating'] || null,
          active: row['Is Active'] !== false,
          inflowCategory: row['Original InFlow Category'] || null,
        },
        create: {
          sku,
          name: row['Product Name'] || sku,
          category: row['Clean Category'] || 'Uncategorized',
          subcategory: row['Product Type'] || null,
          cost,
          basePrice: price,
          doorSize: row['Door Size'] || null,
          handing: row['Handing'] || null,
          coreType: row['Core Type'] || null,
          panelStyle: row['Panel Style'] || null,
          jambSize: row['Jamb Size'] || null,
          casingCode: row['Casing'] || null,
          hardwareFinish: row['Hardware Finish'] || null,
          material: row['Material'] || null,
          fireRating: row['Fire Rating'] || null,
          active: row['Is Active'] !== false,
          inflowCategory: row['Original InFlow Category'] || null,
        },
      })
      created++
    } catch (err: any) {
      if (!err.message?.includes('Unique constraint')) {
        console.error(`   ⚠️  Error on ${sku}:`, err.message)
      }
      skipped++
    }
  }

  console.log(`   ✅ ${created} products imported, ${skipped} skipped`)
}

async function seedBOM() {
  console.log('\n🔧 Importing BOM entries...')

  const rows = readSheet(CATALOG_FILE, 'BOM Explorer')
  console.log(`   Found ${rows.length} BOM entries`)

  // Build a SKU→ID map
  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  let created = 0
  let skipped = 0

  // Group by parent SKU to batch
  const byParent = new Map<string, typeof rows>()
  for (const row of rows) {
    const parentSku = row['Finished Product SKU']
    if (!parentSku || !skuMap.has(parentSku)) { skipped++; continue }
    if (!byParent.has(parentSku)) byParent.set(parentSku, [])
    byParent.get(parentSku)!.push(row)
  }

  // We need component SKUs too, but BOM Explorer has component names, not SKUs
  // We'll store them as text references and skip the relation for now
  // Instead, create BOM entries where we can match both parent and component
  for (const [parentSku, components] of byParent) {
    const parentId = skuMap.get(parentSku)!

    for (const comp of components) {
      // Try to find component by name match
      const compName = comp['Component Name']
      if (!compName) { skipped++; continue }

      // For now, store BOM entries with just the parent link
      // Component matching will be improved in Phase 2
      try {
        // Find a product that matches the component name
        const componentProduct = await prisma.product.findFirst({
          where: {
            OR: [
              { name: { contains: compName.substring(0, 30) } },
              { sku: compName },
            ]
          },
          select: { id: true }
        })

        if (componentProduct) {
          await prisma.bomEntry.create({
            data: {
              parentId,
              componentId: componentProduct.id,
              quantity: parseFloat(comp['Quantity']) || 1,
              componentType: comp['Component Type'] || null,
            }
          })
          created++
        } else {
          skipped++
        }
      } catch (err: any) {
        skipped++
      }
    }
  }

  console.log(`   ✅ ${created} BOM entries linked, ${skipped} skipped (component not found)`)
}

async function seedBuilders() {
  console.log('\n👷 Importing builder accounts...')

  const rows = readSheet(LIVE_FILE, 'Builder Accounts')
  console.log(`   Found ${rows.length} builder accounts`)

  const defaultHash = await bcrypt.hash('Abel2026!', 12)
  let created = 0
  let skipped = 0

  for (const row of rows) {
    const companyName = row['Company Name']
    if (!companyName) { skipped++; continue }

    const email = row['Email'] || `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}@builder.abel.com`

    try {
      await prisma.builder.upsert({
        where: { email },
        update: {
          companyName,
          contactName: row['Primary Contact'] || companyName,
          phone: row['Phone'] || null,
          paymentTerm: mapPaymentTerm(row['Payment Terms']),
        },
        create: {
          companyName,
          contactName: row['Primary Contact'] || companyName,
          email,
          passwordHash: defaultHash,
          phone: row['Phone'] || null,
          paymentTerm: mapPaymentTerm(row['Payment Terms']),
          status: 'ACTIVE',
          emailVerified: true,
        },
      })
      created++
    } catch (err: any) {
      console.error(`   ⚠️  Error on ${companyName}:`, err.message)
      skipped++
    }
  }

  console.log(`   ✅ ${created} builders imported, ${skipped} skipped`)
}

async function seedBuilderPricing() {
  console.log('\n💰 Importing builder-specific pricing...')

  const rows = readSheet(LIVE_FILE, 'Builder Pricing')
  console.log(`   Found ${rows.length} products with builder pricing`)

  // Get all builders and products
  const builders = await prisma.builder.findMany({ select: { id: true, companyName: true } })
  const builderMap = new Map<string, string>()
  for (const b of builders) {
    builderMap.set(b.companyName.toLowerCase(), b.id)
  }

  const products = await prisma.product.findMany({ select: { id: true, sku: true, cost: true } })
  const skuMap = new Map(products.map(p => [p.sku, { id: p.id, cost: p.cost }]))

  // Builder column names from the spreadsheet (columns D onwards)
  const builderColumns = [
    'AGD', 'Astoria Homes', 'Beaver Builders', 'Beechwood Custom Homes',
    'BROOKFIELD', 'CAS CONSTRUCTION', 'Country Road Homebuilders', 'Dalton',
    'Daniel', 'Davenport Builders', 'David Weekly Homes', 'DFW Installations',
    'FIG TREE HOMES', 'FIRST TEXAS HOMES', 'GH HOMES', 'Harvest Home Designs',
    'Hunt Homes', 'Imagination Homes', 'Jake Jackson', 'James Lancaster',
    'JCLI Homes', 'JOSEPH PAUL HOMES', 'Key Custom Homes', 'LaLa Construction',
    'Malibu Homes', 'McClintock', 'Millcreek', 'NEWPORT HOMEBUILDERS',
    'Precision Barn Homes', 'Pulte', 'RDR Developement',
    'Stately Design and Renovation', 'STONEHOLLOW', 'SUMMA TERRA',
    'TGC Custom Homes', 'TOLL BROTHERS', 'Trophy', 'TRUTH CONSTRUCTION',
    'TX BUILT CONST', 'Victor Myers', 'Villa May'
  ]

  // Map column names to builder IDs
  const colToBuilder = new Map<string, string>()
  for (const col of builderColumns) {
    // Try exact match first, then case-insensitive
    let builderId = builderMap.get(col.toLowerCase())
    if (!builderId) {
      // Try partial match
      for (const [name, id] of builderMap) {
        if (name.includes(col.toLowerCase()) || col.toLowerCase().includes(name)) {
          builderId = id
          break
        }
      }
    }
    if (builderId) colToBuilder.set(col, builderId)
  }

  console.log(`   Matched ${colToBuilder.size} builder columns to accounts`)

  let created = 0
  let skipped = 0

  for (const row of rows) {
    const sku = row['SKU']
    const product = skuMap.get(sku)
    if (!sku || !product) { skipped++; continue }

    for (const [col, builderId] of colToBuilder) {
      const price = parseFloat(row[col])
      if (!price || isNaN(price) || price <= 0) continue

      // Calculate margin
      const margin = product.cost > 0 ? (price - product.cost) / price : null

      try {
        await prisma.builderPricing.upsert({
          where: {
            builderId_productId: {
              builderId,
              productId: product.id,
            }
          },
          update: { customPrice: price, margin },
          create: {
            builderId,
            productId: product.id,
            customPrice: price,
            margin,
          },
        })
        created++
      } catch (err: any) {
        skipped++
      }
    }
  }

  console.log(`   ✅ ${created} builder prices imported, ${skipped} skipped`)
}

async function main() {
  console.log('🚀 Abel Builder Platform — Real Data Import')
  console.log('============================================')

  await seedProducts()
  await seedBuilders()
  await seedBuilderPricing()
  await seedBOM()

  // Print summary
  const productCount = await prisma.product.count()
  const builderCount = await prisma.builder.count()
  const pricingCount = await prisma.builderPricing.count()
  const bomCount = await prisma.bomEntry.count()

  console.log('\n============================================')
  console.log('📊 Import Summary:')
  console.log(`   Products:        ${productCount}`)
  console.log(`   Builders:        ${builderCount}`)
  console.log(`   Builder Prices:  ${pricingCount}`)
  console.log(`   BOM Entries:     ${bomCount}`)
  console.log('============================================')
  console.log('\n✅ Done! Your real catalog is now live.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('\n❌ Import failed!')
    console.error('Error type:', e.constructor?.name)
    console.error('Message:', e.message)
    if (e.code) console.error('Code:', e.code)
    if (e.stack) console.error('\nStack trace:', e.stack)
    await prisma.$disconnect()
    process.exit(1)
  })
