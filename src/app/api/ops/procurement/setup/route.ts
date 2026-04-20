export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/procurement/setup — Create all procurement tables
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Procurement', undefined, { method: 'POST' }).catch(() => {})

    // ── Supplier table ──────────────────────────────────────────────────
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Supplier" (
        "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "name"            TEXT NOT NULL,
        "code"            TEXT UNIQUE,
        "type"            TEXT NOT NULL DEFAULT 'DOMESTIC',
        "country"         TEXT DEFAULT 'US',
        "region"          TEXT,
        "contactName"     TEXT,
        "contactEmail"    TEXT,
        "contactPhone"    TEXT,
        "website"         TEXT,
        "address"         TEXT,
        "city"            TEXT,
        "state"           TEXT,
        "zip"             TEXT,
        "paymentTerms"    TEXT DEFAULT 'NET_30',
        "currency"        TEXT DEFAULT 'USD',
        "minOrderValue"   DOUBLE PRECISION DEFAULT 0,
        "avgLeadTimeDays" INTEGER DEFAULT 7,
        "shippingMethod"  TEXT,
        "dutyRate"        DOUBLE PRECISION DEFAULT 0,
        "freightCostPct"  DOUBLE PRECISION DEFAULT 0,
        "qualityRating"   DOUBLE PRECISION DEFAULT 3.0,
        "reliabilityScore" DOUBLE PRECISION DEFAULT 3.0,
        "onTimeDeliveryPct" DOUBLE PRECISION DEFAULT 90,
        "categories"      TEXT[],
        "notes"           TEXT,
        "status"          TEXT DEFAULT 'ACTIVE',
        "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── SupplierProduct — links suppliers to products with pricing ───────
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupplierProduct" (
        "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "supplierId"    TEXT NOT NULL REFERENCES "Supplier"("id") ON DELETE CASCADE,
        "productId"     TEXT REFERENCES "Product"("id"),
        "sku"           TEXT,
        "productName"   TEXT NOT NULL,
        "category"      TEXT NOT NULL,
        "unitCost"      DOUBLE PRECISION NOT NULL,
        "moq"           INTEGER DEFAULT 1,
        "leadTimeDays"  INTEGER DEFAULT 14,
        "packSize"      INTEGER DEFAULT 1,
        "currency"      TEXT DEFAULT 'USD',
        "landedCost"    DOUBLE PRECISION,
        "lastQuoteDate" TIMESTAMPTZ,
        "priceValidUntil" TIMESTAMPTZ,
        "notes"         TEXT,
        "active"        BOOLEAN DEFAULT true,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── InventoryItem — tracks stock levels per product ─────────────────
    // Table is created by migration-v11. Add missing columns if needed.
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InventoryItem" (
        "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "productId"       TEXT NOT NULL,
        "sku"             TEXT,
        "productName"     TEXT,
        "category"        TEXT,
        "location"        TEXT DEFAULT 'MAIN_WAREHOUSE',
        "onHand"          INTEGER DEFAULT 0,
        "committed"       INTEGER DEFAULT 0,
        "onOrder"         INTEGER DEFAULT 0,
        "available"       INTEGER DEFAULT 0,
        "reorderPoint"    INTEGER DEFAULT 10,
        "reorderQty"      INTEGER DEFAULT 50,
        "safetyStock"     INTEGER DEFAULT 5,
        "maxStock"        INTEGER DEFAULT 200,
        "unitCost"        DOUBLE PRECISION DEFAULT 0,
        "avgDailyUsage"   DOUBLE PRECISION DEFAULT 0,
        "daysOfSupply"    DOUBLE PRECISION DEFAULT 0,
        "warehouseZone"   TEXT,
        "binLocation"     TEXT,
        "status"          TEXT DEFAULT 'IN_STOCK',
        "lastReceivedAt"  TIMESTAMPTZ,
        "lastCountedAt"   TIMESTAMPTZ,
        "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── PurchaseOrder — uses Vendor table from migration-v11 ──────────
    // The PurchaseOrder table is created by migration-v11 with FK to Vendor.
    // This setup creates a procurement-specific version that references Supplier.
    // Only create if it doesn't already exist.
    await prisma.$queryRawUnsafe(`
      DO $$ BEGIN
        CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
          "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "poNumber"        TEXT UNIQUE NOT NULL,
          "vendorId"        TEXT,
          "status"          TEXT DEFAULT 'DRAFT',
          "subtotal"        DOUBLE PRECISION DEFAULT 0,
          "shippingCost"    DOUBLE PRECISION DEFAULT 0,
          "total"           DOUBLE PRECISION DEFAULT 0,
          "expectedDate"    TIMESTAMPTZ,
          "receivedAt"      TIMESTAMPTZ,
          "orderedAt"       TIMESTAMPTZ,
          "notes"           TEXT,
          "createdById"     TEXT,
          "approvedById"    TEXT,
          "inflowId"        TEXT,
          "inflowVendorId"  TEXT,
          "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
        );
      EXCEPTION WHEN duplicate_table THEN NULL; END $$
    `)

    // ── PurchaseOrderItem ───────────────────────────────────────────────
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
        "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "poId"          TEXT NOT NULL REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE,
        "productId"     TEXT REFERENCES "Product"("id"),
        "sku"           TEXT,
        "productName"   TEXT NOT NULL,
        "quantity"      INTEGER NOT NULL,
        "unitCost"      DOUBLE PRECISION NOT NULL,
        "lineTotal"     DOUBLE PRECISION NOT NULL,
        "quantityReceived" INTEGER DEFAULT 0,
        "notes"         TEXT,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── ProcurementAlert — AI-generated alerts and recommendations ──────
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProcurementAlert" (
        "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "type"        TEXT NOT NULL,
        "priority"    TEXT DEFAULT 'MEDIUM',
        "title"       TEXT NOT NULL,
        "message"     TEXT NOT NULL,
        "category"    TEXT,
        "productId"   TEXT,
        "supplierId"  TEXT,
        "data"        JSONB DEFAULT '{}',
        "status"      TEXT DEFAULT 'ACTIVE',
        "actionTaken" TEXT,
        "resolvedAt"  TIMESTAMPTZ,
        "resolvedBy"  TEXT,
        "createdAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── DemandForecast — AI predictions for upcoming needs ─────────────
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DemandForecast" (
        "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "productId"       TEXT REFERENCES "Product"("id"),
        "sku"             TEXT NOT NULL,
        "category"        TEXT NOT NULL,
        "forecastDate"    DATE NOT NULL,
        "periodDays"      INTEGER DEFAULT 30,
        "predictedQty"    INTEGER NOT NULL,
        "confidenceLevel" DOUBLE PRECISION DEFAULT 0.7,
        "basedOnOrders"   INTEGER DEFAULT 0,
        "basedOnQuotes"   INTEGER DEFAULT 0,
        "seasonalFactor"  DOUBLE PRECISION DEFAULT 1.0,
        "trendFactor"     DOUBLE PRECISION DEFAULT 1.0,
        "notes"           TEXT,
        "createdAt"       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── Indexes ─────────────────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS "idx_supplier_status" ON "Supplier"("status")`,
      `CREATE INDEX IF NOT EXISTS "idx_supplier_type" ON "Supplier"("type")`,
      `CREATE INDEX IF NOT EXISTS "idx_supplierproduct_supplier" ON "SupplierProduct"("supplierId")`,
      `CREATE INDEX IF NOT EXISTS "idx_supplierproduct_product" ON "SupplierProduct"("productId")`,
      `CREATE INDEX IF NOT EXISTS "idx_supplierproduct_category" ON "SupplierProduct"("category")`,
      `CREATE INDEX IF NOT EXISTS "idx_inventory_sku" ON "InventoryItem"("sku")`,
      `CREATE INDEX IF NOT EXISTS "idx_inventory_category" ON "InventoryItem"("category")`,
      `CREATE INDEX IF NOT EXISTS "idx_inventory_status" ON "InventoryItem"("status")`,
      `CREATE INDEX IF NOT EXISTS "idx_inventory_product" ON "InventoryItem"("productId")`,
      `CREATE INDEX IF NOT EXISTS "idx_po_supplier" ON "PurchaseOrder"("supplierId")`,
      `CREATE INDEX IF NOT EXISTS "idx_po_status" ON "PurchaseOrder"("status")`,
      `CREATE INDEX IF NOT EXISTS "idx_po_number" ON "PurchaseOrder"("poNumber")`,
      `CREATE INDEX IF NOT EXISTS "idx_poitem_po" ON "PurchaseOrderItem"("poId")`,
      `CREATE INDEX IF NOT EXISTS "idx_alert_type" ON "ProcurementAlert"("type")`,
      `CREATE INDEX IF NOT EXISTS "idx_alert_status" ON "ProcurementAlert"("status")`,
      `CREATE INDEX IF NOT EXISTS "idx_forecast_sku" ON "DemandForecast"("sku")`,
      `CREATE INDEX IF NOT EXISTS "idx_forecast_date" ON "DemandForecast"("forecastDate")`,
    ]

    for (const idx of indexes) {
      await prisma.$queryRawUnsafe(idx)
    }

    return NextResponse.json({ success: true, message: 'Procurement tables created successfully' })
  } catch (error: unknown) {
    console.error('Procurement setup error:', error)
    return NextResponse.json(
      { error: 'Failed to setup procurement tables', details: String(error) },
      { status: 500 }
    )
  }
}
