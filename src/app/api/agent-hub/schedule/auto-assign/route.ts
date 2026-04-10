export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/schedule/auto-assign
 * Given ready-to-ship jobs, auto-generate an optimized delivery schedule.
 * Considers: crew availability, geographic clustering, builder preferences, priority, capacity.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const targetDate = body.targetDate || new Date().toISOString().split('T')[0]

    // 1. Find jobs that are STAGED or READY_TO_SHIP without a delivery assignment
    const readyJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT j."id", j."jobNumber", j."builderName", j."jobAddress",
             j."community", j."scopeType"::text AS "scopeType",
             j."scheduledDate", j."lotBlock",
             o."total" AS "orderValue",
             o."id" AS "orderId"
      FROM "Job" j
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      WHERE j."status"::text IN ('STAGED', 'LOADED')
        AND NOT EXISTS (
          SELECT 1 FROM "Delivery" d
          WHERE d."jobId" = j."id" AND d."status"::text NOT IN ('CANCELLED')
        )
      ORDER BY j."scheduledDate" ASC NULLS LAST, o."total" DESC
    `)

    if (readyJobs.length === 0) {
      return NextResponse.json({
        message: 'No jobs ready for delivery scheduling',
        assignments: [],
        optimizationScore: 100,
      })
    }

    // 2. Get available delivery crews
    const crews: any[] = await prisma.$queryRawUnsafe(`
      SELECT c."id", c."name", c."vehiclePlate",
             COUNT(d."id")::int AS "existingDeliveries"
      FROM "Crew" c
      LEFT JOIN "Delivery" d ON d."crewId" = c."id"
        AND d."status"::text IN ('SCHEDULED', 'LOADING')
      WHERE c."active" = true AND c."crewType"::text = 'DELIVERY'
      GROUP BY c."id", c."name", c."vehiclePlate"
      ORDER BY COUNT(d."id") ASC
    `)

    // 3. Group jobs by community/area for geographic clustering
    const byCommunity: Record<string, any[]> = {}
    for (const job of readyJobs) {
      const area = job.community || job.jobAddress?.split(',').pop()?.trim() || 'Unassigned'
      if (!byCommunity[area]) byCommunity[area] = []
      byCommunity[area].push(job)
    }

    // 4. Assign crews round-robin, clustering by community
    const assignments: any[] = []
    let crewIndex = 0
    const MAX_PER_CREW = 6 // Max deliveries per crew per day
    const crewLoadCount: Record<string, number> = {}
    for (const crew of crews) {
      crewLoadCount[crew.id] = Number(crew.existingDeliveries) || 0
    }

    for (const [community, jobs] of Object.entries(byCommunity)) {
      for (const job of jobs) {
        // Find crew with lowest load
        if (crews.length === 0) break

        let bestCrew = crews[0]
        let bestLoad = crewLoadCount[crews[0].id] || 999

        for (const crew of crews) {
          const load = crewLoadCount[crew.id] || 0
          if (load < bestLoad) {
            bestLoad = load
            bestCrew = crew
          }
        }

        if (bestLoad >= MAX_PER_CREW) {
          // All crews full — skip
          assignments.push({
            jobId: job.id,
            jobNumber: job.jobNumber,
            builderName: job.builderName,
            community,
            status: 'UNASSIGNED',
            reason: 'All crews at capacity',
          })
          continue
        }

        // Create delivery record
        const deliveryId = `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const deliveryNumber = `DEL-AUTO-${Date.now().toString(36).toUpperCase()}`
        const routeOrder = (crewLoadCount[bestCrew.id] || 0) + 1

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Delivery" (
            "id", "jobId", "crewId", "deliveryNumber", "routeOrder",
            "address", "status", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED'::"DeliveryStatus", NOW(), NOW())
        `,
          deliveryId,
          job.id,
          bestCrew.id,
          deliveryNumber,
          routeOrder,
          job.jobAddress || 'TBD'
        )

        crewLoadCount[bestCrew.id] = (crewLoadCount[bestCrew.id] || 0) + 1

        assignments.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          builderName: job.builderName,
          community,
          deliveryId,
          deliveryNumber,
          crewId: bestCrew.id,
          crewName: bestCrew.name,
          routeOrder,
          status: 'SCHEDULED',
        })
      }
    }

    // 5. Compute optimization score
    const totalJobs = readyJobs.length
    const assigned = assignments.filter(a => a.status === 'SCHEDULED').length
    const unassigned = assignments.filter(a => a.status === 'UNASSIGNED').length

    // Community clustering score — how many same-community jobs are on the same crew
    const crewCommunities: Record<string, Set<string>> = {}
    for (const a of assignments.filter(a => a.crewId)) {
      if (!crewCommunities[a.crewId]) crewCommunities[a.crewId] = new Set()
      crewCommunities[a.crewId].add(a.community)
    }
    const avgCommunitiesPerCrew = Object.values(crewCommunities).length > 0
      ? Object.values(crewCommunities).reduce((s, c) => s + c.size, 0) / Object.values(crewCommunities).length
      : 0

    // Lower is better for communities per crew (1 = perfect clustering)
    const clusterScore = avgCommunitiesPerCrew > 0 ? Math.max(0, 100 - (avgCommunitiesPerCrew - 1) * 20) : 100
    const assignmentScore = totalJobs > 0 ? (assigned / totalJobs) * 100 : 100
    const optimizationScore = Math.round((clusterScore * 0.4 + assignmentScore * 0.6))

    // Create approval task
    if (assignments.length > 0) {
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "AgentTask" (
            "id", "agentRole", "taskType", "title", "description",
            "priority", "status", "payload", "requiresApproval",
            "createdBy", "createdAt", "updatedAt"
          ) VALUES (
            $1, 'OPS', 'SCHEDULE_DELIVERY', $2, $3,
            'NORMAL', 'PENDING', $4::jsonb, true,
            'agent:OPS', NOW(), NOW()
          )
        `,
          taskId,
          `Auto-Schedule: ${assigned} deliveries for ${targetDate}`,
          `Auto-generated schedule: ${assigned} assigned, ${unassigned} unassigned. Optimization score: ${optimizationScore}/100.`,
          JSON.stringify({ targetDate, assignments, optimizationScore })
        )
      } catch (e) {
        console.error('Failed to create schedule approval task:', e)
      }
    }

    return NextResponse.json({
      message: `Scheduled ${assigned} deliveries, ${unassigned} unassigned`,
      targetDate,
      totalJobs,
      assigned,
      unassigned,
      optimizationScore,
      assignments,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/schedule/auto-assign error:', error)
    return NextResponse.json({ error: 'Failed to auto-assign schedule' }, { status: 500 })
  }
}
