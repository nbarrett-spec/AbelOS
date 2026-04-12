export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface BriefingStop {
  id: string
  stopNumber: number
  timeWindow: string
  type: 'DELIVERY' | 'INSTALLATION' | 'PICKUP'
  address: string
  builderName: string
  builderCompany?: string
  jobNumber: string
  specialInstructions?: string
  items: Array<{
    description: string
    quantity: number
  }>
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
  coordinates?: {
    lat: number
    lng: number
  }
}

interface DailyBriefing {
  crewName: string
  crewId: string
  date: string
  totalStops: number
  deliveries: number
  installations: number
  estimatedDriveTime: string
  stops: BriefingStop[]
  allCompleted: boolean
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const crewId = searchParams.get('crewId')
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

    if (!crewId) {
      return NextResponse.json(
        { error: 'crewId is required' },
        { status: 400 }
      )
    }

    // Get crew info
    const crew = await prisma.$queryRawUnsafe<Array<{
      id: string
      name: string
    }>>(
      `SELECT id, name FROM "Crew" WHERE id = $1`,
      crewId
    )

    if (!crew || crew.length === 0) {
      return NextResponse.json(
        { error: 'Crew not found' },
        { status: 404 }
      )
    }

    const crewName = crew[0].name

    // Parse date
    const startDate = new Date(date)
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(date)
    endDate.setHours(23, 59, 59, 999)

    // Get all schedule entries for this crew on this date
    const scheduleEntries = await prisma.$queryRawUnsafe<Array<{
      id: string
      jobId: string
      title: string
      jobNumber: string
      builderName: string
      jobAddress: string | null
      community: string | null
      lotBlock: string | null
      builderContact: string | null
      scheduledTime: string | null
      status: string
      entryType: string
      deliveryId: string | null
      installationId: string | null
      deliveryStatus: string | null
      installationStatus: string | null
    }>>(
      `
      SELECT
        se.id, se."jobId", se.title, se.status, se."entryType", se."scheduledTime",
        j.id as "jobNumber_id", j."jobNumber", j."builderName", j."jobAddress",
        j.community, j."lotBlock", j."builderContact",
        d.id as "deliveryId", d.status as "deliveryStatus",
        i.id as "installationId", i.status as "installationStatus"
      FROM "ScheduleEntry" se
      JOIN "Job" j ON se."jobId" = j.id
      LEFT JOIN "Delivery" d ON j.id = d."jobId" AND se."entryType" = 'DELIVERY'
      LEFT JOIN "Installation" i ON j.id = i."jobId" AND se."entryType" = 'INSTALLATION'
      WHERE se."crewId" = $1 AND se."scheduledDate" >= $2 AND se."scheduledDate" <= $3
      ORDER BY se."scheduledTime" ASC
      `,
      crewId,
      startDate,
      endDate
    )

    // Get order items for each job
    const jobIds = scheduleEntries.map(e => e.jobId)
    const orderItems = jobIds.length > 0 ? await prisma.$queryRawUnsafe<Array<{
      jobId: string
      description: string
      quantity: number
    }>>(
      `
      SELECT j.id as "jobId", oi.description, oi.quantity
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      JOIN "Job" j ON o.id = j."orderId"
      WHERE j.id = ANY($1::text[])
      ORDER BY j.id, oi.description
      `,
      jobIds
    ) : []

    // Build response
    const stops: BriefingStop[] = scheduleEntries.map((entry, index) => {
      const jobItemsForThisJob = orderItems.filter(item => item.jobId === entry.jobId)
      const entryType = entry.entryType as 'DELIVERY' | 'INSTALLATION' | 'PICKUP'

      // Determine status - use actual delivery/installation status if available
      let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' = 'NOT_STARTED'
      if (entryType === 'DELIVERY' && entry.deliveryStatus) {
        if (entry.deliveryStatus === 'COMPLETE' || entry.deliveryStatus === 'COMPLETED') {
          status = 'COMPLETED'
        } else if (entry.deliveryStatus === 'IN_TRANSIT' || entry.deliveryStatus === 'ARRIVED' || entry.deliveryStatus === 'UNLOADING') {
          status = 'IN_PROGRESS'
        }
      } else if (entryType === 'INSTALLATION' && entry.installationStatus) {
        if (entry.installationStatus === 'COMPLETE' || entry.installationStatus === 'COMPLETED') {
          status = 'COMPLETED'
        } else if (entry.installationStatus === 'IN_PROGRESS') {
          status = 'IN_PROGRESS'
        }
      }

      return {
        id: entry.id,
        stopNumber: index + 1,
        timeWindow: entry.scheduledTime ? `${entry.scheduledTime}` : 'Time TBD',
        type: entryType,
        address: entry.jobAddress || 'Address TBD',
        builderName: entry.builderName,
        builderCompany: entry.builderContact || undefined,
        jobNumber: entry.jobNumber,
        specialInstructions: undefined,
        items: jobItemsForThisJob.slice(0, 5).map(item => ({
          description: item.description,
          quantity: item.quantity
        })),
        status
      }
    })

    const deliveryCount = stops.filter(s => s.type === 'DELIVERY').length
    const installationCount = stops.filter(s => s.type === 'INSTALLATION').length
    const completedCount = stops.filter(s => s.status === 'COMPLETED').length

    // Calculate drive time based on number of stops
    let estimatedDriveTime: string
    const stopCount = stops.length
    if (stopCount === 0) {
      estimatedDriveTime = 'No stops scheduled'
    } else if (stopCount === 1) {
      estimatedDriveTime = '30-45 min'
    } else if (stopCount === 2) {
      estimatedDriveTime = '1-1.5 hours'
    } else if (stopCount === 3) {
      estimatedDriveTime = '1.5-2 hours'
    } else {
      estimatedDriveTime = `${stopCount * 0.5}-${stopCount * 0.75} hours`
    }

    const briefing: DailyBriefing = {
      crewName,
      crewId,
      date,
      totalStops: stops.length,
      deliveries: deliveryCount,
      installations: installationCount,
      estimatedDriveTime,
      stops,
      allCompleted: completedCount === stops.length && stops.length > 0
    }

    return NextResponse.json(briefing)
  } catch (error) {
    console.error('Failed to get daily briefing:', error)
    return NextResponse.json(
      { error: 'Failed to get daily briefing' },
      { status: 500 }
    )
  }
}
