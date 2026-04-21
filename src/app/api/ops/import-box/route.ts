export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import bcrypt from 'bcryptjs'
import * as XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-box
// Imports customer/builder data from Box export
// ──────────────────────────────────────────────────────────────────────────

// Resolve paths relative to the project root (abel-builder-platform is inside Abel Lumber folder)
const PROJECT_ROOT = process.cwd()
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..')
const BOX_BASE_PATH = path.join(ABEL_FOLDER, 'Abel Door & Trim_ DFW Box Export', 'Abel Door & Trim_ DFW')
const CUSTOMERS_DIR = path.join(BOX_BASE_PATH, 'Customers')
const CUSTOMER_LIST_FILE = path.join(CUSTOMERS_DIR, 'Current Customer Community List.xlsx')
const PULTE_PRICING_FILE = path.join(CUSTOMERS_DIR, 'Pulte Homes DFW', 'Pulte_Centex Volume Pricing Guide.xlsx')
const FINANCIAL_DIR = path.join(BOX_BASE_PATH, 'Financial')
const MANAGEMENT_FINANCE_DIR = path.join(BOX_BASE_PATH, 'Management', 'Finance')
const SCOTT_JOHNSON_DIR = path.join(BOX_BASE_PATH, 'Scott Johnson Docs')

// ──────────────────────────────────────────────────────────────────────────
// Helper: Create company email slug
// ──────────────────────────────────────────────────────────────────────────

function createEmailSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Get payment term by builder type
// ──────────────────────────────────────────────────────────────────────────

function getPaymentTerm(companyName: string) {
  const name = companyName.toLowerCase()
  if (name.includes('pulte') || name.includes('brookfield') || name.includes('toll')) {
    return 'NET_15'
  }
  return 'NET_30'
}

// ──────────────────────────────────────────────────────────────────────────
// Import Customers
// ──────────────────────────────────────────────────────────────────────────

async function importCustomers() {
  const results = {
    created: 0,
    updated: 0,
    errors: [] as string[],
    details: [] as any[],
  }

  try {
    // Read the main Excel file
    if (!fs.existsSync(CUSTOMER_LIST_FILE)) {
      results.errors.push(`Customer list file not found: ${CUSTOMER_LIST_FILE}`)
      return results
    }

    const workbook = XLSX.readFile(CUSTOMER_LIST_FILE)
    const processedEmails = new Set<string>()

    // Process each sheet (each is a builder company)
    for (const sheetName of workbook.SheetNames) {
      // Skip TEMPLATE sheet
      if (sheetName.toLowerCase() === 'template') continue

      try {
        const sheet = workbook.Sheets[sheetName]
        const data = XLSX.utils.sheet_to_json(sheet) as any[]

        if (data.length === 0) continue

        // Get first row for contact info
        const firstRow = data[0]
        const companyName = sheetName
        const contactName = firstRow['Builder Name'] || firstRow['Contact Name'] || 'Unknown'
        const contactEmail = firstRow['Builder Email'] || firstRow['Email'] || ''
        const contactPhone = firstRow['Builder Phone Number'] || firstRow['Phone'] || ''
        const contactCity = firstRow['City'] || 'Unknown'

        // Generate email if not provided
        let email = contactEmail?.trim()
        if (!email || !email.includes('@')) {
          email = `contact@${createEmailSlug(companyName)}.com`
        }

        // Skip duplicate emails
        if (processedEmails.has(email)) {
          results.details.push({
            companyName,
            email,
            status: 'skipped',
            reason: 'duplicate_email',
          })
          continue
        }
        processedEmails.add(email)

        const passwordHash = await bcrypt.hash('abel2026', 10)
        const paymentTerm = getPaymentTerm(companyName)

        const builder = await (prisma as any).builder.upsert({
          where: { email },
          update: {
            companyName,
            contactName,
            phone: contactPhone,
            city: contactCity,
            state: 'TX',
            paymentTerm,
          },
          create: {
            companyName,
            contactName,
            email,
            passwordHash,
            phone: contactPhone,
            city: contactCity,
            state: 'TX',
            paymentTerm,
            status: 'ACTIVE',
          },
        })

        // Check if it was created or updated
        const existed = await (prisma as any).builder.count({
          where: {
            email,
            createdAt: { lt: new Date(Date.now() - 100) }, // Rough check
          },
        })

        if (existed > 0) {
          results.updated++
        } else {
          results.created++
        }

        results.details.push({
          companyName,
          email,
          contactName,
          paymentTerm,
          status: 'imported',
        })
      } catch (sheetError: any) {
        results.errors.push(`Error processing sheet "${sheetName}": ${sheetError.message}`)
      }
    }

    // Scan Customers directory for builders not in Excel
    try {
      const builderDirs = fs.readdirSync(CUSTOMERS_DIR, { withFileTypes: true })

      for (const dir of builderDirs) {
        if (!dir.isDirectory()) continue

        const companyName = dir.name
        const slug = createEmailSlug(companyName)
        const email = `contact@${slug}.com`

        // Check if already processed from Excel
        if (processedEmails.has(email)) continue

        // Check if builder already exists
        const existing = await (prisma as any).builder.findUnique({
          where: { email },
        })

        if (existing) {
          results.details.push({
            companyName,
            email,
            status: 'already_exists',
          })
          continue
        }

        // Create builder with folder name
        const passwordHash = await bcrypt.hash('abel2026', 10)
        const paymentTerm = getPaymentTerm(companyName)

        await (prisma as any).builder.create({
          data: {
            companyName,
            contactName: 'To be updated',
            email,
            passwordHash,
            city: 'Unknown',
            state: 'TX',
            paymentTerm,
            status: 'ACTIVE',
          },
        })

        results.created++
        results.details.push({
          companyName,
          email,
          source: 'folder_only',
          status: 'imported',
        })
      }
    } catch (dirError: any) {
      results.errors.push(`Error scanning Customers directory: ${dirError.message}`)
    }
  } catch (error: any) {
    results.errors.push(`Customer import failed: ${error.message}`)
  }

  return results
}

// ──────────────────────────────────────────────────────────────────────────
// Import Pricing (Pulte Volume Pricing)
// ──────────────────────────────────────────────────────────────────────────

async function importPricing() {
  const results = {
    created: 0,
    updated: 0,
    errors: [] as string[],
    details: [] as any[],
  }

  try {
    if (!fs.existsSync(PULTE_PRICING_FILE)) {
      results.errors.push(`Pulte pricing file not found: ${PULTE_PRICING_FILE}`)
      return results
    }

    const workbook = XLSX.readFile(PULTE_PRICING_FILE)

    // Log sheet structure
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(sheet) as any[]

      results.details.push({
        sheetName,
        rowCount: data.length,
        columns: data.length > 0 ? Object.keys(data[0]) : [],
        firstRow: data[0],
      })
    }

    results.created = 1 // Mark as found/cataloged
  } catch (error: any) {
    results.errors.push(`Pricing import failed: ${error.message}`)
  }

  return results
}

// ──────────────────────────────────────────────────────────────────────────
// Import Financial (Catalog documents)
// ──────────────────────────────────────────────────────────────────────────

function catalogFinancialDocs(): any[] {
  const documents: any[] = []

  // Helper to recursively find files
  function scanDirectory(dir: string, relativeBase: string = '') {
    try {
      if (!fs.existsSync(dir)) return

      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.join(relativeBase, entry.name)

        if (entry.isDirectory()) {
          scanDirectory(fullPath, relativePath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (['.xlsx', '.xls', '.pdf', '.docx', '.doc'].includes(ext)) {
            let type = 'document'
            let description = ''

            // Classify by name patterns
            if (entry.name.includes('Margin')) {
              type = 'margin_analysis'
              description = 'G2H Margin Analysis'
            } else if (entry.name.includes('Workload')) {
              type = 'workload_review'
              description = 'Workload Review Aug-Dec 2025'
            } else if (entry.name.includes('Inventory') || entry.name.includes('aging')) {
              type = 'inventory'
              description = 'Inventory Aging'
            } else if (entry.name.includes('PO') || entry.name.includes('Purchase')) {
              type = 'purchase_orders'
              description = 'Open Purchase Orders'
            } else if (entry.name.includes('Price') && entry.name.includes('Audit')) {
              type = 'price_audit'
              description = 'Price Audit'
            }

            documents.push({
              fileName: entry.name,
              path: fullPath,
              relativePath,
              type,
              description,
              extension: ext,
            })
          }
        }
      }
    } catch (e) {
      // Silently skip directories we can't access
    }
  }

  // Scan all financial directories
  scanDirectory(FINANCIAL_DIR, 'Financial')
  scanDirectory(MANAGEMENT_FINANCE_DIR, 'Management/Finance')
  scanDirectory(SCOTT_JOHNSON_DIR, 'Scott Johnson Docs')

  return documents
}

async function importFinancial() {
  const results = {
    created: 0,
    updated: 0,
    errors: [] as string[],
    details: [] as any[],
  }

  try {
    const documents = catalogFinancialDocs()
    results.created = documents.length
    results.details = documents

    if (documents.length === 0) {
      results.errors.push('No financial documents found in expected directories')
    }
  } catch (error: any) {
    results.errors.push(`Financial import failed: ${error.message}`)
  }

  return results
}

// ──────────────────────────────────────────────────────────────────────────
// Main POST handler
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { importType } = body

    if (!importType) {
      return NextResponse.json(
        { error: 'Missing importType parameter' },
        { status: 400 }
      )
    }
    audit(request, `IMPORT_BOX_${String(importType).toUpperCase()}`, 'BoxImport', undefined, { importType }, 'WARN').catch(() => {})

    const validTypes = ['customers', 'pricing', 'financial', 'all']
    if (!validTypes.includes(importType)) {
      return NextResponse.json(
        { error: `Invalid importType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    const results: any = {}

    // Run requested imports
    if (importType === 'customers' || importType === 'all') {
      results.customers = await importCustomers()
    }

    if (importType === 'pricing' || importType === 'all') {
      results.pricing = await importPricing()
    }

    if (importType === 'financial' || importType === 'all') {
      results.financial = await importFinancial()
    }

    return NextResponse.json({
      success: true,
      importType,
      timestamp: new Date().toISOString(),
      results,
    })
  } catch (error: any) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Import failed' },
      { status: 500 }
    )
  }
}
