export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; status: string }[] = []

  async function run(step: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step, status: 'OK' })
    } catch (e: any) {
      results.push({ step, status: e.message?.slice(0, 120) || 'ERROR' })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // DocumentVault: Core document metadata table
  // ──────────────────────────────────────────────────────────────────
  await run('Create DocumentVault', `
    CREATE TABLE IF NOT EXISTS "DocumentVault" (
      "id" TEXT PRIMARY KEY,
      "fileName" TEXT NOT NULL,
      "fileType" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "fileSize" INT NOT NULL,
      "category" TEXT NOT NULL DEFAULT 'GENERAL',
      "description" TEXT,
      "tags" TEXT[] DEFAULT '{}',

      -- Storage: either blobUrl (Vercel Blob) or fileData (base64 in PG)
      "storageType" TEXT NOT NULL DEFAULT 'DATABASE' CHECK ("storageType" IN ('DATABASE', 'VERCEL_BLOB', 'EXTERNAL')),
      "blobUrl" TEXT,
      "blobPathname" TEXT,
      "fileData" TEXT,

      -- Entity linking: a document can be linked to one or more entity types
      "entityType" TEXT,
      "entityId" TEXT,
      "secondaryEntityType" TEXT,
      "secondaryEntityId" TEXT,

      -- Common entity shortcuts for fast queries
      "builderId" TEXT,
      "orderId" TEXT,
      "jobId" TEXT,
      "quoteId" TEXT,
      "invoiceId" TEXT,
      "dealId" TEXT,
      "vendorId" TEXT,
      "purchaseOrderId" TEXT,
      "doorIdentityId" TEXT,

      -- Metadata
      "uploadedBy" TEXT NOT NULL,
      "uploadedByName" TEXT,
      "isArchived" BOOLEAN DEFAULT false,
      "version" INT DEFAULT 1,
      "parentDocumentId" TEXT,
      "checksum" TEXT,

      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  // ──────────────────────────────────────────────────────────────────
  // Indexes for fast lookups
  // ──────────────────────────────────────────────────────────────────
  await run('idx vault category', 'CREATE INDEX IF NOT EXISTS "idx_vault_category" ON "DocumentVault"("category")')
  await run('idx vault entity', 'CREATE INDEX IF NOT EXISTS "idx_vault_entity" ON "DocumentVault"("entityType", "entityId")')
  await run('idx vault builder', 'CREATE INDEX IF NOT EXISTS "idx_vault_builder" ON "DocumentVault"("builderId")')
  await run('idx vault order', 'CREATE INDEX IF NOT EXISTS "idx_vault_order" ON "DocumentVault"("orderId")')
  await run('idx vault job', 'CREATE INDEX IF NOT EXISTS "idx_vault_job" ON "DocumentVault"("jobId")')
  await run('idx vault quote', 'CREATE INDEX IF NOT EXISTS "idx_vault_quote" ON "DocumentVault"("quoteId")')
  await run('idx vault invoice', 'CREATE INDEX IF NOT EXISTS "idx_vault_invoice" ON "DocumentVault"("invoiceId")')
  await run('idx vault deal', 'CREATE INDEX IF NOT EXISTS "idx_vault_deal" ON "DocumentVault"("dealId")')
  await run('idx vault vendor', 'CREATE INDEX IF NOT EXISTS "idx_vault_vendor" ON "DocumentVault"("vendorId")')
  await run('idx vault po', 'CREATE INDEX IF NOT EXISTS "idx_vault_po" ON "DocumentVault"("purchaseOrderId")')
  await run('idx vault door', 'CREATE INDEX IF NOT EXISTS "idx_vault_door" ON "DocumentVault"("doorIdentityId")')
  await run('idx vault uploaded', 'CREATE INDEX IF NOT EXISTS "idx_vault_uploaded" ON "DocumentVault"("uploadedBy")')
  await run('idx vault created', 'CREATE INDEX IF NOT EXISTS "idx_vault_created" ON "DocumentVault"("createdAt" DESC)')
  await run('idx vault archived', 'CREATE INDEX IF NOT EXISTS "idx_vault_archived" ON "DocumentVault"("isArchived")')
  await run('idx vault filename', 'CREATE INDEX IF NOT EXISTS "idx_vault_filename" ON "DocumentVault" USING gin(to_tsvector(\'english\', "fileName"))')
  await run('idx vault parent', 'CREATE INDEX IF NOT EXISTS "idx_vault_parent" ON "DocumentVault"("parentDocumentId")')

  // ──────────────────────────────────────────────────────────────────
  // DocumentVaultActivity: Audit trail for document actions
  // ──────────────────────────────────────────────────────────────────
  await run('Create DocumentVaultActivity', `
    CREATE TABLE IF NOT EXISTS "DocumentVaultActivity" (
      "id" TEXT PRIMARY KEY,
      "documentId" TEXT NOT NULL,
      "action" TEXT NOT NULL CHECK ("action" IN ('UPLOADED', 'DOWNLOADED', 'VIEWED', 'UPDATED', 'ARCHIVED', 'RESTORED', 'DELETED', 'LINKED', 'UNLINKED', 'VERSIONED')),
      "staffId" TEXT NOT NULL,
      "staffName" TEXT,
      "details" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await run('idx activity doc', 'CREATE INDEX IF NOT EXISTS "idx_vault_activity_doc" ON "DocumentVaultActivity"("documentId")')
  await run('idx activity staff', 'CREATE INDEX IF NOT EXISTS "idx_vault_activity_staff" ON "DocumentVaultActivity"("staffId")')
  await run('idx activity created', 'CREATE INDEX IF NOT EXISTS "idx_vault_activity_created" ON "DocumentVaultActivity"("createdAt" DESC)')

  return safeJson({ success: true, results })
}
