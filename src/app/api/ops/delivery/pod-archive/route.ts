export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// D-15 — POD (Proof of Delivery) Archive search

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const status = searchParams.get('status') || ''
    const withSignature = searchParams.get('withSignature') === '1'

    const conds: string[] = ['d."completedAt" IS NOT NULL']
    const params: any[] = []
    let idx = 1
    if (q) {
      conds.push(`(d."deliveryNumber" ILIKE $${idx} OR o."orderNumber" ILIKE $${idx} OR b."companyName" ILIKE $${idx})`)
      params.push(`%${q}%`)
      idx++
    }
    if (from) {
      conds.push(`d."completedAt" >= $${idx}::timestamptz`)
      params.push(from)
      idx++
    }
    if (to) {
      conds.push(`d."completedAt" <= $${idx}::timestamptz`)
      params.push(to)
      idx++
    }
    if (status) {
      conds.push(`d."status"::text = $${idx}`)
      params.push(status)
      idx++
    }
    const where = `WHERE ${conds.join(' AND ')}`

    const sql = `
      SELECT d."id", d."deliveryNumber", d."status"::text AS status,
             d."completedAt", d."signedBy", d."notes", d."damageNotes",
             j."id" AS "jobId", j."jobNumber",
             o."id" AS "orderId", o."orderNumber",
             b."companyName" AS "builderName"
      FROM "Delivery" d
      LEFT JOIN "Job" j ON j."id" = d."jobId"
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      ${where}
      ORDER BY d."completedAt" DESC
      LIMIT 100
    `
    const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params)

    // Parse [PROOF-JSON] sentinel from notes for each row
    const deliveries = rows.map((r) => {
      let proof: any = null
      let photosCount = 0
      let hasSignature = false
      let recipientName: string | null = null
      const notes: string = r.notes || ''
      const m = notes.match(/\[PROOF-JSON\]:\s*(\{.*\})\s*$/m)
      if (m) {
        try {
          proof = JSON.parse(m[1])
          photosCount = Number(proof.photosCount || 0)
          hasSignature = !!proof.hasSignature
          recipientName = proof.recipientName || null
        } catch {
          // ignore
        }
      }

      return {
        id: r.id,
        deliveryNumber: r.deliveryNumber,
        status: r.status,
        completedAt: r.completedAt,
        builderName: r.builderName,
        orderNumber: r.orderNumber,
        jobNumber: r.jobNumber,
        signedBy: r.signedBy || recipientName,
        photosCount,
        hasSignature,
        proof: proof
          ? {
              recipientName: proof.recipientName,
              capturedAt: proof.capturedAt,
              damagedItems: proof.damagedItems || [],
              hasSignature,
              photosCount,
              signatureDataUrl: proof.signatureDataUrl,
              photos: proof.photos || [],
            }
          : null,
      }
    })

    const filtered = withSignature ? deliveries.filter((d) => d.hasSignature) : deliveries

    return NextResponse.json({ deliveries: filtered })
  } catch (e: any) {
    console.error('[GET /api/ops/delivery/pod-archive] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to load POD archive' }, { status: 500 })
  }
}
