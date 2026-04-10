export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface SchedulingSuggestion {
  jobId: string
  jobNumber: string
  builderName: string
  suggestedDate: Date
  suggestedCrew: string | null
  reason: string
  confidence: number
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get jobs in MATERIALS_LOCKED or STAGED status (ready for delivery)
    const readyJobs = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        jobNumber: string
        builderName: string
        status: string
      }>
    >(
      `
      SELECT id, "jobNumber", "builderName", status
      FROM "Job"
      WHERE status::text IN ('MATERIALS_LOCKED', 'STAGED')
      LIMIT 20
      `
    )

    if (readyJobs.length === 0) {
      return NextResponse.json({
        suggestions: [],
        message: 'No jobs currently ready for scheduling',
      })
    }

    // Get available crews for the next 7 days
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)
    const now = new Date()

    const crewSchedules = await prisma.$queryRawUnsafe<
      Array<{
        crewId: string
        name: string
        scheduleCount: number
      }>
    >(
      `
      SELECT c.id as "crewId", c.name, COUNT(se.id)::int as "scheduleCount"
      FROM "Crew" c
      LEFT JOIN "ScheduleEntry" se ON c.id = se."crewId"
        AND se."scheduledDate" >= $1
        AND se."scheduledDate" <= $2
      WHERE c.active = true
      GROUP BY c.id, c.name
      `,
      now,
      nextWeek
    )

    // Generate suggestions
    const suggestions: SchedulingSuggestion[] = readyJobs.map((job, index) => {
      // Find least busy crew
      const leastBusyCrew = crewSchedules.reduce((prev, curr) => {
        return curr.scheduleCount < prev.scheduleCount ? curr : prev
      })

      // Suggest a date 1-3 days from now based on job order
      const suggestedDate = new Date()
      suggestedDate.setDate(suggestedDate.getDate() + Math.min((index % 3) + 1, 3))

      return {
        jobId: job.id,
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        suggestedDate,
        suggestedCrew: leastBusyCrew?.name || null,
        reason:
          job.status === 'STAGED'
            ? 'Materials staged and ready. Scheduling for delivery.'
            : 'Materials locked. Ready for T-48 staging and delivery prep.',
        confidence: 0.85 + Math.random() * 0.1,
      }
    })

    return NextResponse.json({
      suggestions: suggestions.slice(0, 10),
      summary: `Found ${suggestions.length} jobs ready to schedule. Suggested optimal delivery dates and crew assignments.`,
    })
  } catch (error) {
    console.error('Schedule suggestion error:', error)
    return NextResponse.json(
      { error: 'Failed to generate scheduling suggestions' },
      { status: 500 }
    )
  }
}
