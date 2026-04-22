/**
 * Agent Workflow Detail API
 * GET: Get full workflow detail with all action results
 * PATCH: Pause/resume/cancel a workflow
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// In-memory workflow store (imported from main route)
const workflowStore = new Map()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkStaffAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const workflow = workflowStore.get(id)

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      workflow,
    })
  } catch (error) {
    console.error('Error fetching workflow:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workflow' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkStaffAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Audit log
    audit(request, 'UPDATE', 'Agent', undefined, { method: 'PATCH' }).catch(() => {})

    const { id } = await params
    const body = await request.json()
    const { action } = body

    const workflow = workflowStore.get(id)
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (action === 'pause') {
      workflow.status = 'PAUSED'
    } else if (action === 'resume') {
      workflow.status = 'RUNNING'
    } else if (action === 'cancel') {
      workflow.status = 'FAILED'
      workflow.completedAt = new Date()
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use pause, resume, or cancel.' },
        { status: 400 }
      )
    }

    workflowStore.set(id, workflow)

    return NextResponse.json({
      success: true,
      workflow,
    })
  } catch (error) {
    console.error('Error updating workflow:', error)
    return NextResponse.json(
      { error: 'Failed to update workflow' },
      { status: 500 }
    )
  }
}
