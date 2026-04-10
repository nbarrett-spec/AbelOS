export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// GET /api/deliveries/[orderId]/photos — Get delivery photos for a builder's order
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  try {
    // Verify order belongs to builder and get delivery info
    // Delivery links to Job which links to Order which links to Builder
    const deliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT d.id, d."deliveryNumber", d.status::text as status,
             d."departedAt", d."arrivedAt", d."completedAt", d.address,
             d."loadPhotos", d."sitePhotos",
             d."signedBy", d."damageNotes", d.notes,
             j."jobNumber", j.community, j."lotBlock",
             d."createdAt"
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j.id
      JOIN "Order" o ON j."orderId" = o.id
      WHERE o.id = $1 AND o."builderId" = $2
      ORDER BY d."createdAt" DESC
      LIMIT 10
    `, params.orderId, session.builderId)

    let results = deliveries

    // Process photos
    const deliveriesWithPhotos = results.map((d: any) => ({
      id: d.id,
      deliveryNumber: d.deliveryNumber,
      status: d.status,
      departedAt: d.departedAt,
      arrivedAt: d.arrivedAt,
      completedAt: d.completedAt,
      address: d.address,
      signedBy: d.signedBy,
      damageNotes: d.damageNotes,
      notes: d.notes,
      jobNumber: d.jobNumber,
      community: d.community,
      lotBlock: d.lotBlock,
      loadPhotos: Array.isArray(d.loadPhotos) ? d.loadPhotos : [],
      sitePhotos: Array.isArray(d.sitePhotos) ? d.sitePhotos : [],
      photoCount: (Array.isArray(d.loadPhotos) ? d.loadPhotos.length : 0) +
                  (Array.isArray(d.sitePhotos) ? d.sitePhotos.length : 0),
    }))

    return NextResponse.json({ deliveries: deliveriesWithPhotos })
  } catch (error: any) {
    console.error('Delivery photos error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
