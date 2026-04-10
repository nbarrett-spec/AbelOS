export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 14)

    // Crew utilization for next 2 weeks
    const scheduleEntries = await prisma.$queryRawUnsafe<Array<{ crewId: string; crewName: string; status: string; scheduledDate: Date; entryType: string }>>(
      `SELECT se."crewId", c.name as "crewName", se.status, se."scheduledDate", se."entryType"
       FROM "ScheduleEntry" se
       LEFT JOIN "Crew" c ON se."crewId" = c.id
       WHERE se."scheduledDate" >= $1 AND se."scheduledDate" <= $2`,
      weekStart, weekEnd
    )

    // Group by crew
    const crewMap = new Map()
    scheduleEntries.forEach((entry) => {
      if (!entry.crewId) return
      if (!crewMap.has(entry.crewId)) {
        crewMap.set(entry.crewId, {
          crewId: entry.crewId,
          crewName: entry.crewName || 'Unknown',
          scheduled: 0,
          inProgress: 0,
          completed: 0,
        })
      }
      const crew = crewMap.get(entry.crewId)
      if (entry.status === 'IN_PROGRESS') crew.inProgress++
      else if (entry.status === 'COMPLETED') crew.completed++
      else crew.scheduled++
    })

    const crewUtilization = Array.from(crewMap.values())

    // Schedule heatmap - deliveries and installations by day
    const heatmapData = new Map()
    for (let i = 0; i < 14; i++) {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + i)
      const dateKey = date.toISOString().split('T')[0]
      heatmapData.set(dateKey, {
        date: dateKey,
        deliveries: 0,
        installations: 0,
        total: 0,
      })
    }

    scheduleEntries.forEach((entry) => {
      const dateKey = entry.scheduledDate.toISOString().split('T')[0]
      const data = heatmapData.get(dateKey)
      if (data) {
        if (entry.entryType === 'DELIVERY') data.deliveries++
        if (entry.entryType === 'INSTALLATION') data.installations++
        data.total++
      }
    })

    const heatmapArray = Array.from(heatmapData.values())

    // Calculate avg days per order status stage from real data
    const velocityRaw = await prisma.$queryRawUnsafe<Array<{ status: string; avgDays: number; orderCount: number }>>(
      `SELECT
        status::text as status,
        ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 86400.0), 0)::numeric, 1) as "avgDays",
        COUNT(*)::int as "orderCount"
       FROM "Order"
       GROUP BY status
       ORDER BY
         CASE status
           WHEN 'RECEIVED' THEN 1
           WHEN 'CONFIRMED' THEN 2
           WHEN 'IN_PRODUCTION' THEN 3
           WHEN 'READY_TO_SHIP' THEN 4
           WHEN 'SHIPPED' THEN 5
           WHEN 'DELIVERED' THEN 6
           WHEN 'COMPLETE' THEN 7
           WHEN 'CANCELLED' THEN 8
           ELSE 9
         END`
    )

    const velocityData = velocityRaw.map(v => ({
      status: v.status,
      avgDays: Number(v.avgDays),
      orderCount: Number(v.orderCount),
    }))

    // Exception tracker
    const exceptions = await prisma.$queryRawUnsafe<Array<{ id: string; jobNumber: string | null; noteType: string; subject: string; staffName: string | null; createdAt: Date }>>(
      `SELECT dn.id, j."jobNumber", dn."noteType", dn.subject, CONCAT(s."firstName", ' ', s."lastName") as "staffName", dn."createdAt"
       FROM "DecisionNote" dn
       LEFT JOIN "Job" j ON dn."jobId" = j.id
       LEFT JOIN "Staff" s ON dn."authorId" = s.id
       WHERE dn."noteType" IN ('EXCEPTION', 'ESCALATION')
       ORDER BY dn."createdAt" DESC
       LIMIT 20`
    )

    // Vendor performance
    const vendors = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; onTimeRate: number | null; avgLeadDays: number | null }>>(
      `SELECT id, name, "onTimeRate", "avgLeadDays" FROM "Vendor"`
    )

    const vendorPOs = await prisma.$queryRawUnsafe<Array<{ vendorId: string; status: string; total: number }>>(
      `SELECT "vendorId", status, "total" FROM "PurchaseOrder"`
    )

    const vendorPerformance = vendors.map((vendor) => {
      const vendorPOList = vendorPOs.filter((po) => po.vendorId === vendor.id)
      const totalPos = vendorPOList.length
      const receivedPos = vendorPOList.filter((po) =>
        ['RECEIVED', 'PARTIALLY_RECEIVED'].includes(po.status)
      ).length
      const openValue = vendorPOList
        .filter((po) => po.status !== 'RECEIVED')
        .reduce((sum, po) => sum + Number(po.total), 0)

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        onTimeRate: vendor.onTimeRate || 0.85,
        avgLeadDays: vendor.avgLeadDays || 14,
        totalOrders: totalPos,
        openPOValue: openValue,
      }
    })

    return NextResponse.json(
      {
        crewUtilization,
        scheduleHeatmap: heatmapArray,
        jobVelocity: velocityData,
        exceptions: exceptions.map((note) => ({
          id: note.id,
          jobNumber: note.jobNumber,
          noteType: note.noteType,
          subject: note.subject,
          author: note.staffName || 'Unknown',
          createdAt: note.createdAt,
        })),
        vendorPerformance,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Operations API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch operations data' },
      { status: 500 }
    )
  }
}
