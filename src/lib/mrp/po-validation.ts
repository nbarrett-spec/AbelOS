import { prisma } from '@/lib/prisma'

export interface POValidationWarning {
  jobId: string
  jobNumber: string | null
  scheduledDate: Date
  poArrival: Date
  daysMissing: number
}

export interface POValidationResult {
  onTime: boolean
  warnings: POValidationWarning[]
}

/**
 * Validate a PO's expectedDate against all related job schedules.
 * Returns onTime status and warnings for jobs that may not receive materials in time.
 *
 * GAP-10: Check if PO.expectedDate + 1 day receiving buffer meets Job.scheduledDate
 */
export async function validatePOAgainstJobs(poId: string): Promise<POValidationResult> {
  // Get the PO
  const po = await prisma.$queryRawUnsafe<
    Array<{ id: string; expectedDate: Date | null }>
  >(
    `SELECT "id", "expectedDate" FROM "PurchaseOrder" WHERE "id" = $1 LIMIT 1`,
    poId
  )

  if (po.length === 0) {
    return { onTime: true, warnings: [] }
  }

  const poRow = po[0]
  if (!poRow.expectedDate) {
    return { onTime: true, warnings: [] }
  }

  // Add 1 day buffer for receiving
  const poArrivalDate = new Date(poRow.expectedDate.getTime() + 86400000)

  // Find all SmartPORecommendations linked to this PO
  const recommendations = await prisma.$queryRawUnsafe<
    Array<{ id: string; relatedJobIds: any }>
  >(
    `
    SELECT "id", "relatedJobIds"
    FROM "SmartPORecommendation"
    WHERE "convertedPOId" = $1 OR "id" IN (
      SELECT "recommendationId" FROM "PurchaseOrder" WHERE "id" = $2
    )
    `,
    poId,
    poId
  )

  const jobIds = new Set<string>()
  for (const rec of recommendations) {
    if (Array.isArray(rec.relatedJobIds)) {
      rec.relatedJobIds.forEach((jid: string) => jobIds.add(jid))
    }
  }

  if (jobIds.size === 0) {
    return { onTime: true, warnings: [] }
  }

  // Get job details
  const jobs = await prisma.$queryRawUnsafe<
    Array<{ id: string; jobNumber: string | null; scheduledDate: Date | null }>
  >(
    `
    SELECT "id", "jobNumber", "scheduledDate"
    FROM "Job"
    WHERE "id" = ANY($1::text[])
    `,
    Array.from(jobIds)
  )

  const warnings: POValidationWarning[] = []
  let onTime = true

  for (const job of jobs) {
    if (!job.scheduledDate) continue

    const daysMissing = Math.ceil(
      (job.scheduledDate.getTime() - poArrivalDate.getTime()) / 86400000
    )

    if (daysMissing < 0) {
      onTime = false
      warnings.push({
        jobId: job.id,
        jobNumber: job.jobNumber,
        scheduledDate: job.scheduledDate,
        poArrival: poArrivalDate,
        daysMissing: daysMissing, // negative = late
      })
    }
  }

  return { onTime, warnings }
}

/**
 * Get warnings for a PO and log them to console (for API response or logging)
 */
export async function getPOValidationWarnings(poId: string): Promise<string[]> {
  const result = await validatePOAgainstJobs(poId)
  const messages: string[] = []

  if (!result.onTime) {
    for (const w of result.warnings) {
      messages.push(
        `Job ${w.jobNumber || w.jobId} scheduled ${w.scheduledDate.toISOString().slice(0, 10)} ` +
        `but PO arrives ${w.poArrival.toISOString().slice(0, 10)} (${Math.abs(w.daysMissing)} days late)`
      )
    }
  }

  return messages
}
