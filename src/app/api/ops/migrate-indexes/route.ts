export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';

// Migration: Add composite indexes for common query patterns
// These improve performance on the most frequently used list/filter queries

const indexMigrations = [
  // ─── ORDERS: filtered by builder + status, sorted by date ───
  `CREATE INDEX IF NOT EXISTS "idx_order_builder_status" ON "Order" ("builderId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_order_status_created" ON "Order" ("status", "createdAt" DESC);`,

  // ─── QUOTES: filtered by project + status ───
  `CREATE INDEX IF NOT EXISTS "idx_quote_project_status" ON "Quote" ("projectId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_quote_status_created" ON "Quote" ("status", "createdAt" DESC);`,

  // ─── JOBS: filtered by status + scheduled date (daily dispatch) ───
  `CREATE INDEX IF NOT EXISTS "idx_job_status_scheduled" ON "Job" ("status", "scheduledDate");`,
  `CREATE INDEX IF NOT EXISTS "idx_job_pm_status" ON "Job" ("assignedPMId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_job_builder_community" ON "Job" ("builderName", "community");`,

  // ─── SCHEDULE ENTRIES: daily crew schedule lookup ───
  `CREATE INDEX IF NOT EXISTS "idx_schedule_crew_date" ON "ScheduleEntry" ("crewId", "scheduledDate");`,
  `CREATE INDEX IF NOT EXISTS "idx_schedule_date_status" ON "ScheduleEntry" ("scheduledDate", "status");`,

  // ─── DELIVERIES: crew route lookup ───
  `CREATE INDEX IF NOT EXISTS "idx_delivery_crew_status" ON "Delivery" ("crewId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_delivery_job_status" ON "Delivery" ("jobId", "status");`,

  // ─── INSTALLATIONS: crew assignment lookup ───
  `CREATE INDEX IF NOT EXISTS "idx_install_crew_status" ON "Installation" ("crewId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_install_job_status" ON "Installation" ("jobId", "status");`,

  // ─── INVOICES: builder AR, overdue tracking ───
  `CREATE INDEX IF NOT EXISTS "idx_invoice_builder_status" ON "Invoice" ("builderId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_invoice_status_due" ON "Invoice" ("status", "dueDate");`,
  `CREATE INDEX IF NOT EXISTS "idx_invoice_job" ON "Invoice" ("jobId");`,

  // ─── PURCHASE ORDERS: vendor + status filtering ───
  `CREATE INDEX IF NOT EXISTS "idx_po_vendor_status" ON "PurchaseOrder" ("vendorId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_po_status_expected" ON "PurchaseOrder" ("status", "expectedDate");`,

  // ─── TASKS: assignee dashboard ───
  `CREATE INDEX IF NOT EXISTS "idx_task_assignee_status" ON "Task" ("assigneeId", "status");`,
  `CREATE INDEX IF NOT EXISTS "idx_task_status_due" ON "Task" ("status", "dueDate");`,
  `CREATE INDEX IF NOT EXISTS "idx_task_job_status" ON "Task" ("jobId", "status");`,

  // ─── ACTIVITIES: timeline views ───
  `CREATE INDEX IF NOT EXISTS "idx_activity_builder_created" ON "Activity" ("builderId", "createdAt" DESC);`,
  `CREATE INDEX IF NOT EXISTS "idx_activity_job_created" ON "Activity" ("jobId", "createdAt" DESC);`,

  // ─── NOTIFICATIONS: unread count, staff inbox ───
  `CREATE INDEX IF NOT EXISTS "idx_notification_staff_read" ON "Notification" ("staffId", "read");`,
  `CREATE INDEX IF NOT EXISTS "idx_notification_staff_created" ON "Notification" ("staffId", "createdAt" DESC);`,

  // ─── MESSAGES: conversation timeline ───
  `CREATE INDEX IF NOT EXISTS "idx_message_conv_created" ON "Message" ("conversationId", "createdAt" DESC);`,

  // ─── DEALS: pipeline views ───
  `CREATE INDEX IF NOT EXISTS "idx_deal_owner_stage" ON "Deal" ("ownerId", "stage");`,
  `CREATE INDEX IF NOT EXISTS "idx_deal_stage_close" ON "Deal" ("stage", "expectedCloseDate");`,

  // ─── PRODUCTS: catalog browsing ───
  `CREATE INDEX IF NOT EXISTS "idx_product_category_active" ON "Product" ("category", "active");`,
  `CREATE INDEX IF NOT EXISTS "idx_product_active_name" ON "Product" ("active", "name");`,

  // ─── MATERIAL PICKS: job picking workflow ───
  `CREATE INDEX IF NOT EXISTS "idx_materialpick_job_status" ON "MaterialPick" ("jobId", "status");`,

  // ─── DECISION NOTES: job timeline ───
  `CREATE INDEX IF NOT EXISTS "idx_decisionnote_job_created" ON "DecisionNote" ("jobId", "createdAt" DESC);`,

  // ─── BUILDERS: search and filtering ───
  `CREATE INDEX IF NOT EXISTS "idx_builder_status_company" ON "Builder" ("status", "companyName");`,
];

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const results: { index: number; name: string; status: string; error?: string }[] = [];

    for (let i = 0; i < indexMigrations.length; i++) {
      const sql = indexMigrations[i];
      // Extract index name for reporting
      const nameMatch = sql.match(/"(idx_[^"]+)"/);
      const name = nameMatch ? nameMatch[1] : `migration_${i}`;

      try {
        // Strip trailing semicolons — Prisma doesn't allow them
        await prisma.$executeRawUnsafe(sql.replace(/;\s*$/, ''));
        results.push({ index: i, name, status: 'OK' });
      } catch (err: any) {
        results.push({ index: i, name, status: 'ERROR', error: err.message?.slice(0, 200) });
      }
    }

    const succeeded = results.filter(r => r.status === 'OK').length;
    const failed = results.filter(r => r.status === 'ERROR');

    return NextResponse.json({
      total: indexMigrations.length,
      succeeded,
      failed: failed.length,
      errors: failed,
    });
  } catch (error: any) {
    console.error('Index migration failed:', error);
    return NextResponse.json(
      { error: 'Index migration failed', details: error.message },
      { status: 500 }
    );
  }
}
