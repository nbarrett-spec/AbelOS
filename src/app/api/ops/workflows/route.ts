export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { executeWorkflows, getWorkflowDefinitions, WORKFLOW_DEFINITIONS } from '@/lib/workflows'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Helper to get staff info from headers
function getStaffFromHeaders(headers: Headers) {
  return {
    staffId: headers.get('x-staff-id') || 'unknown',
    role: headers.get('x-staff-role') || 'unknown',
    email: headers.get('x-staff-email') || 'unknown',
  }
}

// GET /api/ops/workflows — List all defined workflows
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const workflows = getWorkflowDefinitions()

    // Format for JSON response - convert functions to strings for readability
    const formattedWorkflows = workflows.map((wf) => ({
      event: wf.event,
      hasCondition: !!wf.condition,
      actionCount: wf.actions.length,
      actions: wf.actions.map((action) => ({
        type: action.type,
        config: Object.keys(action.config).join(', '),
      })),
    }))

    return NextResponse.json({
      count: workflows.length,
      workflows: formattedWorkflows,
      definitions: WORKFLOW_DEFINITIONS.map((wf) => ({
        event: wf.event,
        actions: wf.actions,
      })),
    })
  } catch (error: any) {
    console.error('GET /api/ops/workflows error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/workflows — Manually trigger a workflow (admin only)
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Workflows', undefined, { method: 'POST' }).catch(() => {})

    const staff = getStaffFromHeaders(request.headers)

    // Admin-only check
    if (staff.role !== 'ADMIN' && staff.role !== 'MANAGER') {
      return NextResponse.json(
        { error: 'Unauthorized - admin/manager access required' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { event, context } = body

    if (!event) {
      return NextResponse.json({ error: 'Missing event' }, { status: 400 })
    }

    if (!context || typeof context !== 'object') {
      return NextResponse.json({ error: 'Missing or invalid context' }, { status: 400 })
    }

    // Add staffId from headers if not in context
    const enrichedContext = {
      ...context,
      staffId: context.staffId || staff.staffId,
    }

    // Execute workflows
    const result = await executeWorkflows(event, enrichedContext)

    return NextResponse.json(
      {
        success: true,
        event,
        context: enrichedContext,
        ...result,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('POST /api/ops/workflows error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
