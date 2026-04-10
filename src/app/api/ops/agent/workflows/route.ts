/**
 * Agent Workflows API
 * GET: List recent workflows
 * POST: Trigger a workflow manually
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import {
  executeBlueprintToQuoteWorkflow,
  executeStaleQuoteRecoveryWorkflow,
  executeNewBuilderWelcomeWorkflow,
  executeReorderOpportunityWorkflow,
} from '@/lib/agent-orchestrator'
import { prisma } from '@/lib/prisma'

// In-memory workflow store (for demo — in production, use database)
const workflowStore: Map<string, any> = new Map()

export async function GET(request: NextRequest) {
  const auth = await checkStaffAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Return recent workflows from store
    const workflows = Array.from(workflowStore.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20)

    return NextResponse.json({
      success: true,
      workflows,
      count: workflows.length,
    })
  } catch (error) {
    console.error('Error fetching workflows:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch workflows' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await checkStaffAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { workflow: workflowType, params } = body

    if (!workflowType || !params) {
      return NextResponse.json(
        { error: 'Missing workflow type or params' },
        { status: 400 }
      )
    }

    let executedWorkflow

    switch (workflowType) {
      case 'BLUEPRINT_TO_QUOTE':
        if (!params.blueprintId || !params.projectId) {
          return NextResponse.json(
            { error: 'Missing blueprintId or projectId' },
            { status: 400 }
          )
        }

        const project = await prisma.$queryRawUnsafe(
          `SELECT "builderId" FROM "Project" WHERE id = $1`,
          params.projectId
        )

        if (!project || (project as any[]).length === 0) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        executedWorkflow = await executeBlueprintToQuoteWorkflow(
          (project as any[])[0].builderId,
          params.blueprintId,
          params.projectId
        )
        break

      case 'STALE_QUOTE_RECOVERY':
        if (!params.quoteId) {
          return NextResponse.json({ error: 'Missing quoteId' }, { status: 400 })
        }

        const quote = await prisma.$queryRawUnsafe(
          `SELECT p."builderId" FROM "Quote" q JOIN "Project" p ON q."projectId" = p.id WHERE q.id = $1`,
          params.quoteId
        )

        if (!quote || (quote as any[]).length === 0) {
          return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
        }

        executedWorkflow = await executeStaleQuoteRecoveryWorkflow(
          params.quoteId,
          (quote as any[])[0].builderId
        )
        break

      case 'NEW_BUILDER_WELCOME':
        if (!params.builderId) {
          return NextResponse.json({ error: 'Missing builderId' }, { status: 400 })
        }

        executedWorkflow = await executeNewBuilderWelcomeWorkflow(params.builderId)
        break

      case 'REORDER_OPPORTUNITY':
        if (!params.builderId) {
          return NextResponse.json({ error: 'Missing builderId' }, { status: 400 })
        }

        executedWorkflow = await executeReorderOpportunityWorkflow(params.builderId)
        break

      default:
        return NextResponse.json(
          { error: `Unknown workflow type: ${workflowType}` },
          { status: 400 }
        )
    }

    // Store workflow
    workflowStore.set(executedWorkflow.id, executedWorkflow)

    return NextResponse.json({
      success: true,
      workflow: executedWorkflow,
    })
  } catch (error) {
    console.error('Error executing workflow:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute workflow' },
      { status: 500 }
    )
  }
}
