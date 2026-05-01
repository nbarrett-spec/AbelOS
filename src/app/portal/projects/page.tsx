/**
 * Builder Portal — Projects.
 *
 * Phase 4 of BUILDER-PORTAL-SPEC.md (§4.10).
 *
 * Server fetches /api/projects (already builder-scoped) which returns
 * name, address, community, status, planName plus aggregated orderCount,
 * totalSpend, upcomingDeliveryCount, nextDeliveryDate per project.
 *
 * Client owns search + community filter (mirrors PortalContext community
 * selector) + grid/list toggle.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import {
  ProjectsClient,
  type PortalProjectRow,
} from './_ProjectsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Projects',
  description: 'All your active jobs and lots.',
}

interface ProjectsResponse {
  projects: PortalProjectRow[]
}

async function fetchProjects(): Promise<PortalProjectRow[]> {
  try {
    const cookieStore = await cookies()
    const headerStore = await headers()
    const proto =
      headerStore.get('x-forwarded-proto') ||
      (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const host =
      headerStore.get('x-forwarded-host') ||
      headerStore.get('host') ||
      `localhost:${process.env.PORT || 3000}`
    const url = `${proto}://${host}/api/projects`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as ProjectsResponse
    return data.projects ?? []
  } catch {
    return []
  }
}

export default async function PortalProjectsPage() {
  const session = await getSession()
  if (!session) return null

  const projects = await fetchProjects()

  return (
    <Suspense fallback={null}>
      <ProjectsClient projects={projects} />
    </Suspense>
  )
}
