export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { table: string; status: string; error?: string }[] = []

  const tables = [
    {
      name: 'CollectionAction_drop',
      sql: `DROP TABLE IF EXISTS "CollectionAction" CASCADE`
    },
    {
      name: 'CollectionAction',
      sql: `CREATE TABLE "CollectionAction" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "invoiceId" TEXT NOT NULL,
        "actionType" TEXT NOT NULL,
        "channel" TEXT NOT NULL DEFAULT 'EMAIL',
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sentBy" TEXT,
        "notes" TEXT,
        "response" TEXT,
        "respondedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CollectionAction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`
    },
    {
      name: 'CollectionAction_indexes',
      sql: `CREATE INDEX IF NOT EXISTS "idx_collection_invoice" ON "CollectionAction"("invoiceId");
CREATE INDEX IF NOT EXISTS "idx_collection_type_sent" ON "CollectionAction"("actionType", "sentAt")`
    },
    {
      name: 'OrderTemplate',
      sql: `CREATE TABLE IF NOT EXISTS "OrderTemplate" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "builderId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "sourceOrderId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OrderTemplate_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "OrderTemplate_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`
    },
    {
      name: 'OrderTemplateItem',
      sql: `CREATE TABLE IF NOT EXISTS "OrderTemplateItem" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "templateId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "notes" TEXT,
        CONSTRAINT "OrderTemplateItem_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OrderTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "OrderTemplateItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`
    },
    {
      name: 'OrderTemplate_indexes',
      sql: `CREATE INDEX IF NOT EXISTS "idx_template_builder" ON "OrderTemplate"("builderId");
CREATE INDEX IF NOT EXISTS "idx_templateitem_template" ON "OrderTemplateItem"("templateId")`
    },
    {
      name: 'DeliveryTracking',
      sql: `CREATE TABLE IF NOT EXISTS "DeliveryTracking" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "deliveryId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "location" TEXT,
        "notes" TEXT,
        "eta" TIMESTAMP(3),
        "updatedBy" TEXT,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DeliveryTracking_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DeliveryTracking_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`
    },
    {
      name: 'DeliveryTracking_indexes',
      sql: `CREATE INDEX IF NOT EXISTS "idx_tracking_delivery" ON "DeliveryTracking"("deliveryId", "timestamp");
CREATE INDEX IF NOT EXISTS "idx_tracking_status" ON "DeliveryTracking"("status")`
    },
    {
      name: 'CollectionRule',
      sql: `CREATE TABLE IF NOT EXISTS "CollectionRule" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "name" TEXT NOT NULL,
        "daysOverdue" INTEGER NOT NULL,
        "actionType" TEXT NOT NULL,
        "channel" TEXT NOT NULL DEFAULT 'EMAIL',
        "templateBody" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CollectionRule_pkey" PRIMARY KEY ("id")
      )`
    },
    {
      name: 'CollectionRule_defaults',
      sql: "INSERT INTO \"CollectionRule\" (\"id\", \"name\", \"daysOverdue\", \"actionType\", \"channel\", \"templateBody\", \"isActive\") VALUES " +
        "(gen_random_uuid()::text, 'Friendly Reminder', 7, 'REMINDER', 'EMAIL', 'Hi {{builderName}}, this is a friendly reminder that invoice {{invoiceNumber}} for ${{amount}} is due on {{dueDate}}. Please let us know if you have any questions.', true), " +
        "(gen_random_uuid()::text, 'Payment Due Notice', 15, 'PAST_DUE', 'EMAIL', 'Hi {{builderName}}, invoice {{invoiceNumber}} for ${{amount}} was due on {{dueDate}} and is now {{daysOverdue}} days past due. Please arrange payment at your earliest convenience.', true), " +
        "(gen_random_uuid()::text, 'Past Due Warning', 30, 'PAST_DUE', 'EMAIL', 'Hi {{builderName}}, invoice {{invoiceNumber}} for ${{amount}} is now {{daysOverdue}} days past due. Please contact us immediately to arrange payment and avoid account restrictions.', true), " +
        "(gen_random_uuid()::text, 'Final Notice', 45, 'FINAL_NOTICE', 'EMAIL', 'FINAL NOTICE: Invoice {{invoiceNumber}} for ${{amount}} is {{daysOverdue}} days past due. If payment is not received within 5 business days, your account may be placed on hold.', true), " +
        "(gen_random_uuid()::text, 'Account Hold', 60, 'ACCOUNT_HOLD', 'EMAIL', 'Your Abel Lumber account has been placed on hold due to invoice {{invoiceNumber}} being {{daysOverdue}} days past due. New orders cannot be processed until this balance is resolved.', true) " +
        "ON CONFLICT DO NOTHING"
    }
  ]

  for (const table of tables) {
    try {
      const statements = table.sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)

      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt)
      }
      results.push({ table: table.name, status: 'OK' })
    } catch (err: any) {
      results.push({ table: table.name, status: 'ERROR', error: err.message?.slice(0, 300) })
    }
  }

  return NextResponse.json({
    success: results.every(r => r.status === 'OK'),
    results
  })
}
