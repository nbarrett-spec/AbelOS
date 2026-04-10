/**
 * Product Expansion Migration
 *
 * Adds schema foundations for expanding beyond doors into:
 * - Trim & Millwork
 * - Windows
 * - Hardware
 * - Framing / Structural
 * - Cabinets & Countertops
 * - General Building Materials
 *
 * Also adds ProductCategory and Supplier models for multi-vendor sourcing
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

const migrations: { name: string; sql: string }[] = [
  // ═══════════════════════════════════════════════════════════════════
  // PRODUCT CATEGORY SYSTEM
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create ProductCategory table',
    sql: `CREATE TABLE IF NOT EXISTS "ProductCategory" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "parentId" TEXT REFERENCES "ProductCategory"("id"),
      "description" TEXT,
      "icon" TEXT,
      "sortOrder" INT DEFAULT 0,
      "active" BOOLEAN DEFAULT true,
      "productCount" INT DEFAULT 0,
      "marginTarget" DOUBLE PRECISION DEFAULT 0.35,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Seed product categories',
    sql: `INSERT INTO "ProductCategory" ("id", "name", "slug", "description", "icon", "sortOrder", "marginTarget") VALUES
      ('cat_doors', 'Doors', 'doors', 'Interior and exterior door units, slabs, and door systems', '🚪', 1, 0.35),
      ('cat_trim', 'Trim & Millwork', 'trim-millwork', 'Baseboards, crown moulding, casing, chair rail, custom millwork', '📐', 2, 0.40),
      ('cat_windows', 'Windows', 'windows', 'Residential and commercial windows, skylights, window systems', '🪟', 3, 0.30),
      ('cat_hardware', 'Door & Window Hardware', 'hardware', 'Locksets, hinges, closers, handles, weatherstripping', '🔧', 4, 0.45),
      ('cat_framing', 'Framing & Structural', 'framing', 'Dimensional lumber, engineered wood, LVL, trusses', '🏗️', 5, 0.20),
      ('cat_cabinets', 'Cabinets & Countertops', 'cabinets', 'Kitchen and bath cabinetry, vanities, countertop surfaces', '🗄️', 6, 0.38),
      ('cat_siding', 'Siding & Exterior', 'siding', 'Fiber cement, vinyl, stone veneer, exterior trim', '🏠', 7, 0.32),
      ('cat_insulation', 'Insulation', 'insulation', 'Batt, blown, spray foam, rigid board insulation', '🧱', 8, 0.28),
      ('cat_roofing', 'Roofing', 'roofing', 'Shingles, underlayment, flashing, ventilation', '🏘️', 9, 0.25),
      ('cat_flooring', 'Flooring', 'flooring', 'Hardwood, LVP, tile, carpet, underlayment', '🪵', 10, 0.33),
      ('cat_general', 'General Materials', 'general', 'Fasteners, adhesives, tools, safety equipment', '📦', 99, 0.30)
    ON CONFLICT ("slug") DO NOTHING`,
  },
  {
    name: 'Add sub-categories for doors',
    sql: `INSERT INTO "ProductCategory" ("id", "name", "slug", "parentId", "description", "sortOrder") VALUES
      ('cat_doors_interior', 'Interior Doors', 'interior-doors', 'cat_doors', 'Interior prehung, slabs, bifold, barn doors', 1),
      ('cat_doors_exterior', 'Exterior Doors', 'exterior-doors', 'cat_doors', 'Entry doors, patio doors, storm doors', 2),
      ('cat_doors_fire', 'Fire-Rated Doors', 'fire-rated-doors', 'cat_doors', '20-min, 45-min, 60-min, 90-min fire-rated assemblies', 3),
      ('cat_doors_specialty', 'Specialty Doors', 'specialty-doors', 'cat_doors', 'Pocket doors, dutch doors, custom designs', 4)
    ON CONFLICT ("slug") DO NOTHING`,
  },
  {
    name: 'Add sub-categories for trim',
    sql: `INSERT INTO "ProductCategory" ("id", "name", "slug", "parentId", "description", "sortOrder") VALUES
      ('cat_trim_base', 'Baseboards', 'baseboards', 'cat_trim', 'Base moulding profiles and materials', 1),
      ('cat_trim_crown', 'Crown Moulding', 'crown-moulding', 'cat_trim', 'Crown profiles and materials', 2),
      ('cat_trim_casing', 'Door & Window Casing', 'casing', 'cat_trim', 'Casing profiles for doors and windows', 3),
      ('cat_trim_custom', 'Custom Millwork', 'custom-millwork', 'cat_trim', 'Custom profiles, mantels, built-ins', 4)
    ON CONFLICT ("slug") DO NOTHING`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIER MANAGEMENT (beyond vendors — for direct-source buying)
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create Supplier table',
    sql: `CREATE TABLE IF NOT EXISTS "Supplier" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL UNIQUE,
      "type" TEXT NOT NULL DEFAULT 'DISTRIBUTOR',
      "contactName" TEXT,
      "email" TEXT,
      "phone" TEXT,
      "website" TEXT,
      "address" TEXT,
      "city" TEXT,
      "state" TEXT,
      "zip" TEXT,
      "categories" TEXT[] DEFAULT '{}',
      "paymentTerms" TEXT DEFAULT 'NET_30',
      "leadTimeDays" INT DEFAULT 14,
      "minOrderAmount" DOUBLE PRECISION DEFAULT 0,
      "freightPolicy" TEXT,
      "discountTiers" JSONB DEFAULT '[]',
      "rebateProgram" JSONB DEFAULT '{}',
      "qualityRating" DOUBLE PRECISION DEFAULT 0,
      "onTimeRate" DOUBLE PRECISION DEFAULT 0,
      "active" BOOLEAN DEFAULT true,
      "notes" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create SupplierProduct (catalog mapping)',
    sql: `CREATE TABLE IF NOT EXISTS "SupplierProduct" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "supplierId" TEXT NOT NULL REFERENCES "Supplier"("id") ON DELETE CASCADE,
      "productId" TEXT,
      "supplierSku" TEXT NOT NULL,
      "supplierProductName" TEXT,
      "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "listPrice" DOUBLE PRECISION,
      "uom" TEXT DEFAULT 'EACH',
      "packSize" INT DEFAULT 1,
      "leadTimeDays" INT,
      "minOrderQty" INT DEFAULT 1,
      "preferred" BOOLEAN DEFAULT false,
      "active" BOOLEAN DEFAULT true,
      "lastPriceDate" DATE,
      "priceHistory" JSONB DEFAULT '[]',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Seed known suppliers',
    sql: `INSERT INTO "Supplier" ("id", "name", "code", "type", "categories", "notes") VALUES
      ('sup_boise', 'Boise Cascade', 'BOISE', 'MANUFACTURER', '{framing,engineered-wood}', 'Existing integration via supplier-pricing sync'),
      ('sup_masonite', 'Masonite', 'MASONITE', 'MANUFACTURER', '{doors,interior-doors,exterior-doors}', 'Major door manufacturer'),
      ('sup_jeldwen', 'JELD-WEN', 'JELDWEN', 'MANUFACTURER', '{doors,windows}', 'Doors and windows manufacturer'),
      ('sup_metrie', 'Metrie', 'METRIE', 'MANUFACTURER', '{trim-millwork,baseboards,crown-moulding,casing}', 'Trim and moulding — current competitor to displace'),
      ('sup_novo', 'Novo Building Products', 'NOVO', 'MANUFACTURER', '{trim-millwork}', 'Moulding supplier — competitor to displace'),
      ('sup_bluelinx', 'BlueLinx', 'BLUELINX', 'DISTRIBUTOR', '{framing,siding,general}', 'Two-step distributor — cut out with direct sourcing'),
      ('sup_84lumber', '84 Lumber', '84LUMBER', 'DISTRIBUTOR', '{framing,windows,doors,general}', 'Distributor/dealer — competitor'),
      ('sup_dw', 'DW Distribution', 'DW', 'DISTRIBUTOR', '{doors,trim-millwork,hardware}', 'Current supplier — target for direct-source replacement'),
      ('sup_tbs', 'TBS (Arrowhead)', 'TBS', 'DISTRIBUTOR', '{doors,trim-millwork}', 'Formerly Arrowhead — competitor to displace')
    ON CONFLICT ("code") DO NOTHING`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // PRODUCT TABLE ENHANCEMENTS
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Add categoryId to Product',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "categoryId" TEXT DEFAULT 'cat_doors'`,
  },
  {
    name: 'Add supplierId to Product',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplierId" TEXT`,
  },
  {
    name: 'Add supplierSku to Product',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplierSku" TEXT`,
  },
  {
    name: 'Add weight to Product (for shipping calc)',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "weight" DOUBLE PRECISION`,
  },
  {
    name: 'Add dimensions to Product',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dimensions" JSONB DEFAULT '{}'`,
  },
  {
    name: 'Add minOrderQty to Product',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minOrderQty" INT DEFAULT 1`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // BUILDER SIGNUP / APPLICATION SYSTEM
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create BuilderApplication table',
    sql: `CREATE TABLE IF NOT EXISTS "BuilderApplication" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "companyName" TEXT NOT NULL,
      "contactName" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "phone" TEXT,
      "website" TEXT,
      "address" TEXT,
      "city" TEXT,
      "state" TEXT DEFAULT 'TX',
      "zip" TEXT,
      "businessType" TEXT,
      "yearsInBusiness" INT,
      "annualRevenue" TEXT,
      "estimatedMonthlyVolume" TEXT,
      "productInterests" TEXT[] DEFAULT '{}',
      "currentSuppliers" TEXT,
      "taxId" TEXT,
      "licenseNumber" TEXT,
      "insuranceCertUrl" TEXT,
      "w9Url" TEXT,
      "creditAppUrl" TEXT,
      "referredBy" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "reviewedBy" TEXT REFERENCES "Staff"("id"),
      "reviewNotes" TEXT,
      "reviewedAt" TIMESTAMPTZ,
      "convertedBuilderId" TEXT REFERENCES "Builder"("id"),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // INDEXES
  {
    name: 'Index: ProductCategory slug',
    sql: `CREATE INDEX IF NOT EXISTS "idx_product_category_slug" ON "ProductCategory"("slug")`,
  },
  {
    name: 'Index: ProductCategory parentId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_product_category_parent" ON "ProductCategory"("parentId")`,
  },
  {
    name: 'Index: Product categoryId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_product_category_id" ON "Product"("categoryId")`,
  },
  {
    name: 'Index: SupplierProduct supplierId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_supplier_product_supplier" ON "SupplierProduct"("supplierId")`,
  },
  {
    name: 'Index: BuilderApplication status',
    sql: `CREATE INDEX IF NOT EXISTS "idx_builder_app_status" ON "BuilderApplication"("status")`,
  },
]

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { name: string; status: 'ok' | 'error'; error?: string }[] = []

  for (const migration of migrations) {
    try {
      await prisma.$executeRawUnsafe(migration.sql)
      results.push({ name: migration.name, status: 'ok' })
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (msg.includes('already exists') || msg.includes('duplicate key')) {
        results.push({ name: migration.name, status: 'ok', error: 'Already exists' })
      } else {
        results.push({ name: migration.name, status: 'error', error: msg })
        console.error(`[ProductExpansion] ${migration.name} FAILED:`, msg)
      }
    }
  }

  const succeeded = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'error').length

  return NextResponse.json({
    success: failed === 0,
    message: `Product expansion: ${succeeded} succeeded, ${failed} failed out of ${migrations.length}`,
    results,
  })
}
