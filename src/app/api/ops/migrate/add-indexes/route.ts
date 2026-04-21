export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/migrate/add-indexes — Add missing performance indexes
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_ADD_INDEXES', 'Database', undefined, { migration: 'RUN_MIGRATE_ADD_INDEXES' }, 'CRITICAL').catch(() => {})

  const results: string[] = []
  let passed = 0
  let failed = 0

  const indexes = [
    // Foreign keys used in frequent JOINs and WHERE clauses
    `CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId")`,
    `CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId")`,
    `CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId")`,
    `CREATE INDEX IF NOT EXISTS "Project_builderId_idx" ON "Project"("builderId")`,
    `CREATE INDEX IF NOT EXISTS "Order_builderId_idx" ON "Order"("builderId")`,
    `CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status")`,
    `CREATE INDEX IF NOT EXISTS "Order_deliveryDate_idx" ON "Order"("deliveryDate")`,
    `CREATE INDEX IF NOT EXISTS "Invoice_builderId_idx" ON "Invoice"("builderId")`,
    `CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status")`,
    `CREATE INDEX IF NOT EXISTS "Invoice_dueDate_idx" ON "Invoice"("dueDate")`,
    `CREATE INDEX IF NOT EXISTS "Quote_projectId_idx" ON "Quote"("projectId")`,
    `CREATE INDEX IF NOT EXISTS "Quote_status_idx" ON "Quote"("status")`,
    `CREATE INDEX IF NOT EXISTS "Job_builderId_idx" ON "Job"("builderId")`,
    `CREATE INDEX IF NOT EXISTS "Job_status_idx" ON "Job"("status")`,
    `CREATE INDEX IF NOT EXISTS "Job_projectId_idx" ON "Job"("projectId")`,
    `CREATE INDEX IF NOT EXISTS "Activity_staffId_idx" ON "Activity"("staffId")`,
    `CREATE INDEX IF NOT EXISTS "Activity_entityId_idx" ON "Activity"("entityId")`,
    `CREATE INDEX IF NOT EXISTS "Activity_createdAt_idx" ON "Activity"("createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "AuditLog_staffId_idx" ON "AuditLog"("staffId")`,
    `CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "Notification_staffId_idx" ON "Notification"("staffId")`,
    `CREATE INDEX IF NOT EXISTS "Notification_read_idx" ON "Notification"("read")`,
    `CREATE INDEX IF NOT EXISTS "SyncLog_provider_idx" ON "SyncLog"("provider")`,
    `CREATE INDEX IF NOT EXISTS "SyncLog_completedAt_idx" ON "SyncLog"("completedAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "StaffRoles_staffId_idx" ON "StaffRoles"("staffId")`,
    `CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category")`,
    `CREATE INDEX IF NOT EXISTS "Product_active_idx" ON "Product"("active")`,
    `CREATE INDEX IF NOT EXISTS "Product_sku_idx" ON "Product"("sku")`,
    `CREATE INDEX IF NOT EXISTS "Builder_email_idx" ON "Builder"("email")`,
    `CREATE INDEX IF NOT EXISTS "Builder_status_idx" ON "Builder"("status")`,
    `CREATE INDEX IF NOT EXISTS "Staff_email_idx" ON "Staff"("email")`,
    `CREATE INDEX IF NOT EXISTS "Staff_active_idx" ON "Staff"("active")`,
    // Composite indexes for common query patterns
    `CREATE INDEX IF NOT EXISTS "Order_builderId_status_idx" ON "Order"("builderId", "status")`,
    `CREATE INDEX IF NOT EXISTS "Invoice_builderId_status_idx" ON "Invoice"("builderId", "status")`,
    `CREATE INDEX IF NOT EXISTS "Job_builderId_status_idx" ON "Job"("builderId", "status")`,
    // Outreach system indexes
    `CREATE INDEX IF NOT EXISTS "OutreachEnrollmentStep_status_scheduledAt_idx" ON "OutreachEnrollmentStep"("status", "scheduledAt")`,
    `CREATE INDEX IF NOT EXISTS "OutreachEnrollment_status_idx" ON "OutreachEnrollment"("status")`,
    // Inspection indexes
    `CREATE INDEX IF NOT EXISTS "Inspection_status_idx" ON "Inspection"("status")`,
    `CREATE INDEX IF NOT EXISTS "Inspection_jobId_idx" ON "Inspection"("jobId")`,
    // Lien release indexes
    `CREATE INDEX IF NOT EXISTS "LienRelease_status_idx" ON "LienRelease"("status")`,
    `CREATE INDEX IF NOT EXISTS "LienRelease_jobId_idx" ON "LienRelease"("jobId")`,
  ]

  for (const sql of indexes) {
    try {
      await prisma.$executeRawUnsafe(sql)
      passed++
      const match = sql.match(/"(\w+_\w+)"/)
      results.push(`OK: ${match ? match[1] : sql.slice(0, 60)}`)
    } catch (e: any) {
      // Most failures are because the table doesn't exist yet — that's fine
      const msg = e?.message || String(e)
      if (msg.includes('does not exist') || msg.includes('relation')) {
        results.push(`SKIP (table missing): ${sql.slice(30, 80)}`)
      } else {
        failed++
        results.push(`FAIL: ${sql.slice(30, 80)} — ${msg.slice(0, 100)}`)
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: `Index migration complete: ${passed} created, ${failed} failed, ${indexes.length - passed - failed} skipped`,
    passed,
    failed,
    total: indexes.length,
    results,
  })
}
