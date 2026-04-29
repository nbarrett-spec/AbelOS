export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// FIX-26 — Finance Data Quality (read-only diagnostic)

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    const findings: Array<{
      id: string
      title: string
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
      count: number
      sampleIds: string[]
      description: string
      action: string
    }> = []

    // 1. $0 invoices not VOID
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Invoice" WHERE "total" = 0 AND "status"::text != 'VOID' ORDER BY "createdAt" DESC LIMIT 50`,
      )
      const cnt = (
        await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "total" = 0 AND "status"::text != 'VOID'`,
        )
      )[0]?.c || 0
      findings.push({
        id: 'zero-invoices',
        title: 'Invoices with $0 total (not VOID)',
        severity: cnt > 50 ? 'HIGH' : cnt > 10 ? 'MEDIUM' : 'LOW',
        count: Number(cnt),
        sampleIds: rows.map((r) => r.id),
        description: 'Invoices created with no line-item value. Either fix the line items, void the invoice, or audit upstream order.',
        action: 'Click an invoice ID to navigate; void or repair as needed.',
      })
    } catch (e) {
      // skip on error
    }

    // 2. Negative-total invoices not VOID
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Invoice" WHERE "total" < 0 AND "status"::text != 'VOID' ORDER BY "createdAt" DESC LIMIT 50`,
      )
      const cnt = (
        await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "total" < 0 AND "status"::text != 'VOID'`,
        )
      )[0]?.c || 0
      findings.push({
        id: 'negative-invoices',
        title: 'Negative-total invoices (likely credits, should be VOID/WRITE_OFF)',
        severity: cnt > 100 ? 'CRITICAL' : cnt > 0 ? 'HIGH' : 'LOW',
        count: Number(cnt),
        sampleIds: rows.map((r) => r.id),
        description: 'Credit memos misclassified — inflates AR aging.',
        action: 'Reclassify to VOID via the invoice detail page.',
      })
    } catch (e) {}

    // 3. DELIVERED orders without invoice
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT o.id FROM "Order" o WHERE o."status"::text = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."orderId" = o."id") ORDER BY o."updatedAt" DESC LIMIT 50`,
      )
      const cnt = (
        await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int AS c FROM "Order" o WHERE o."status"::text = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."orderId" = o."id")`,
        )
      )[0]?.c || 0
      findings.push({
        id: 'delivered-no-invoice',
        title: 'DELIVERED orders without invoice',
        severity: cnt > 1000 ? 'CRITICAL' : cnt > 100 ? 'HIGH' : 'MEDIUM',
        count: Number(cnt),
        sampleIds: rows.map((r) => r.id),
        description: 'Orders that should have generated an invoice. Revenue gap.',
        action: 'Bulk backfill via repair script or manually invoice each.',
      })
    } catch (e) {}

    // 4. Stale DRAFT invoices (> 14 days old)
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Invoice" WHERE "status"::text = 'DRAFT' AND "createdAt" < NOW() - INTERVAL '14 days' ORDER BY "createdAt" ASC LIMIT 50`,
      )
      const cnt = (
        await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "status"::text = 'DRAFT' AND "createdAt" < NOW() - INTERVAL '14 days'`,
        )
      )[0]?.c || 0
      findings.push({
        id: 'stale-drafts',
        title: 'DRAFT invoices older than 14 days',
        severity: cnt > 100 ? 'HIGH' : cnt > 10 ? 'MEDIUM' : 'LOW',
        count: Number(cnt),
        sampleIds: rows.map((r) => r.id),
        description: 'Invoices stuck in DRAFT — should be issued or voided.',
        action: 'Review each; if line items are wrong, fix or void; otherwise issue.',
      })
    } catch (e) {}

    const summary = {
      totalFindings: findings.length,
      critical: findings.filter((f) => f.severity === 'CRITICAL').length,
      high: findings.filter((f) => f.severity === 'HIGH').length,
      medium: findings.filter((f) => f.severity === 'MEDIUM').length,
      lastChecked: new Date().toISOString(),
    }

    return NextResponse.json({ summary, findings })
  } catch (e: any) {
    console.error('[GET /api/ops/finance/data-quality] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to load data quality' }, { status: 500 })
  }
}
