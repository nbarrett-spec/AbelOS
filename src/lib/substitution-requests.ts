/**
 * Substitution request helpers — shared between:
 *   - POST /api/ops/products/[productId]/substitutes/apply
 *         (branches to request-flow when compatibility === 'CONDITIONAL')
 *   - POST /api/ops/substitutions/requests/[id]/approve
 *         (runs the actual allocation swap after a PM approves)
 *
 * Keeps the allocation-swap logic in one place so the approve path is
 * bit-for-bit identical to the auto-apply path — just gated by a PENDING
 * review step.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// Tx handle that supports the $executeRawUnsafe / $queryRawUnsafe calls we
// need. Matches the shape passed to prisma.$transaction(async (tx) => ...).
type TxClient = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>

/**
 * Auto-create the SubstitutionRequest table if it's not yet present. Uses
 * the same pattern as /api/ops/automations to avoid touching prisma/schema.
 * Idempotent — safe to call from every endpoint that touches the table.
 */
export async function ensureSubstitutionRequestTable(): Promise<void> {
  await prisma.$queryRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SubstitutionRequest" (
      "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "jobId"                 TEXT NOT NULL REFERENCES "Job"("id"),
      "originalAllocationId"  TEXT REFERENCES "InventoryAllocation"("id"),
      "originalProductId"     TEXT NOT NULL REFERENCES "Product"("id"),
      "substituteProductId"   TEXT NOT NULL REFERENCES "Product"("id"),
      "quantity"              INT  NOT NULL,
      "requestedById"         TEXT NOT NULL REFERENCES "Staff"("id"),
      "reason"                TEXT,
      "status"                TEXT NOT NULL DEFAULT 'PENDING',
      "approvedById"          TEXT REFERENCES "Staff"("id"),
      "approvedAt"            TIMESTAMPTZ,
      "rejectionNote"         TEXT,
      "createdAt"             TIMESTAMPTZ DEFAULT NOW(),
      "appliedAt"             TIMESTAMPTZ
    )
  `)
  await prisma.$queryRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_subrequest_status" ON "SubstitutionRequest"("status")`
  )
  await prisma.$queryRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_subrequest_job" ON "SubstitutionRequest"("jobId")`
  )
  await prisma.$queryRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_subrequest_requestedBy" ON "SubstitutionRequest"("requestedById")`
  )
}

export interface AllocationSwapInput {
  originalProductId: string
  substituteProductId: string
  jobId: string
  quantity: number
  allocationId: string | null
  staffId: string
  noteSuffix: string // e.g. "— CONDITIONAL — shim required" or similar
}

export interface AllocationSwapResult {
  releasedId: string | null
  newAllocation: {
    id: string
    status: string
    quantity: number
    productId: string
    jobId: string
  }
}

/**
 * The exact allocation-swap sequence used by the apply endpoint. Extracted
 * so the approve endpoint runs the identical transaction.
 */
export async function runAllocationSwap(
  tx: TxClient,
  input: AllocationSwapInput
): Promise<AllocationSwapResult> {
  const {
    originalProductId,
    substituteProductId,
    jobId,
    quantity,
    allocationId,
    staffId,
    noteSuffix,
  } = input

  const note = `Substitute applied (from ${originalProductId}) — ${noteSuffix}`

  let releasedId: string | null = null
  if (allocationId) {
    const existing: any[] = await tx.$queryRawUnsafe(
      `SELECT id, status, quantity, "productId", "jobId"
         FROM "InventoryAllocation"
        WHERE id = $1
        LIMIT 1`,
      allocationId
    )
    if (existing.length > 0) {
      const alloc = existing[0]
      if (alloc.jobId !== jobId) {
        throw new Error(
          `allocationId ${allocationId} belongs to a different job`
        )
      }
      if (['RESERVED', 'BACKORDERED'].includes(alloc.status)) {
        await tx.$executeRawUnsafe(
          `UPDATE "InventoryAllocation"
              SET status = 'RELEASED',
                  "releasedAt" = NOW(),
                  notes = COALESCE(notes || E'\\n', '') || $2,
                  "updatedAt" = NOW()
            WHERE id = $1`,
          allocationId,
          `Released for substitute: ${substituteProductId}`
        )
        releasedId = allocationId
      }
    }
  }

  const newAlloc: any[] = await tx.$queryRawUnsafe(
    `INSERT INTO "InventoryAllocation"
       ("productId", "jobId", quantity, "allocationType", status, "allocatedBy", notes, "allocatedAt")
     VALUES ($1, $2, $3, 'SUBSTITUTE', 'RESERVED', $4, $5, NOW())
     RETURNING id, status, quantity, "productId", "jobId"`,
    substituteProductId,
    jobId,
    quantity,
    staffId,
    note
  )

  return { releasedId, newAllocation: newAlloc[0] }
}
