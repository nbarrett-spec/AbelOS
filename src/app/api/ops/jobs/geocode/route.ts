export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/jobs/geocode — Batch geocode all jobs with addresses but no lat/lng
// Uses Nominatim (free OSM) with 1-second rate limiting.
// Also geocodes Communities with addresses.
// ──────────────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(address)
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1&countrycodes=us`,
      {
        headers: { 'User-Agent': 'Aegis-Geocoder/1.0 (n.barrett@abellumber.com)' },
      }
    )
    if (!resp.ok) return null
    const results = await resp.json()
    if (results.length > 0) {
      return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
    }
    return null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    audit(request, 'GEOCODE', 'Job', undefined, {}).catch(() => {})

    // Ensure lat/lng columns exist on Job (prepared-statement protocol
    // rejects multi-statement strings, so issue each ALTER separately).
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION`)

    // ── Geocode Jobs ────────────────────────────────────────────────────
    const jobs = await prisma.$queryRawUnsafe(`
      SELECT id, "jobAddress", city, state
      FROM "Job"
      WHERE "jobAddress" IS NOT NULL
        AND "jobAddress" != ''
        AND ("latitude" IS NULL OR "longitude" IS NULL)
      ORDER BY "createdAt" DESC
      LIMIT 200
    `) as any[]

    let jobsGeocoded = 0
    let jobsFailed = 0

    for (const job of jobs) {
      // Build full address string
      let addr = job.jobAddress
      if (job.city && !addr.toLowerCase().includes(job.city.toLowerCase())) {
        addr += `, ${job.city}`
      }
      if (job.state && !addr.toLowerCase().includes(job.state.toLowerCase())) {
        addr += `, ${job.state}`
      }
      // Default to Texas/DFW if no state
      if (!addr.toLowerCase().includes('tx') && !addr.toLowerCase().includes('texas')) {
        addr += ', TX'
      }

      const coords = await geocodeAddress(addr)
      if (coords) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET "latitude" = $1, "longitude" = $2 WHERE "id" = $3`,
          coords.lat, coords.lng, job.id
        )
        jobsGeocoded++
      } else {
        jobsFailed++
      }

      // Nominatim rate limit: max 1 request per second
      await sleep(1100)
    }

    // ── Geocode Communities ──────────────────────────────────────────────
    const communities = await prisma.$queryRawUnsafe(`
      SELECT id, address, city, state, zip
      FROM "Community"
      WHERE address IS NOT NULL
        AND address != ''
        AND ("latitude" IS NULL OR "longitude" IS NULL)
      ORDER BY "createdAt" DESC
      LIMIT 100
    `) as any[]

    let commGeocoded = 0

    for (const comm of communities) {
      const parts = [comm.address, comm.city, comm.state, comm.zip].filter(Boolean)
      let addr = parts.join(', ')
      if (!addr.toLowerCase().includes('tx') && !addr.toLowerCase().includes('texas')) {
        addr += ', TX'
      }

      const coords = await geocodeAddress(addr)
      if (coords) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Community" SET "latitude" = $1, "longitude" = $2 WHERE "id" = $3`,
          coords.lat, coords.lng, comm.id
        )
        commGeocoded++
      }

      await sleep(1100)
    }

    return NextResponse.json({
      success: true,
      jobs: { total: jobs.length, geocoded: jobsGeocoded, failed: jobsFailed },
      communities: { total: communities.length, geocoded: commGeocoded },
    })
  } catch (error) {
    console.error('Geocoding error:', error)
    return NextResponse.json({ error: 'Geocoding failed', details: String(error) }, { status: 500 })
  }
}

// GET — check geocoding status
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const stats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalJobs",
      COUNT("jobAddress") FILTER (WHERE "jobAddress" IS NOT NULL AND "jobAddress" != '')::int as "withAddress",
      COUNT("latitude") FILTER (WHERE "latitude" IS NOT NULL)::int as "geocoded",
      COUNT(*) FILTER (WHERE "jobAddress" IS NOT NULL AND "jobAddress" != '' AND "latitude" IS NULL)::int as "pending"
    FROM "Job"
  `) as any[]

  const commStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalCommunities",
      COUNT(address) FILTER (WHERE address IS NOT NULL AND address != '')::int as "withAddress",
      COUNT("latitude") FILTER (WHERE "latitude" IS NOT NULL)::int as "geocoded"
    FROM "Community"
  `) as any[]

  return NextResponse.json({ jobs: stats[0], communities: commStats[0] })
}
