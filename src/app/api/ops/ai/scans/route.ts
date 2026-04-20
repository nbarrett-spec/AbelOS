import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// ─── SCAN TYPE DEFINITIONS ───────────────────────────────────────────────

const SCAN_TYPES = {
  MARKET_RESEARCH: {
    id: 'SCAN_MARKET_RESEARCH',
    name: 'Market Research Scanner',
    description: 'Competitor pricing, market trends, and opportunity identification',
    category: 'Intelligence',
    schedule: 'Every 6 hours'
  },
  EMAIL_INTEL: {
    id: 'SCAN_EMAIL_INTEL',
    name: 'Email Intelligence',
    description: 'Customer signals and patterns from communication',
    category: 'Signals',
    schedule: 'Every 4 hours'
  },
  INVENTORY_OPTIMIZER: {
    id: 'SCAN_INVENTORY_OPTIMIZER',
    name: 'Inventory Optimizer',
    description: 'Stock levels, reorder triggers, and dead stock identification',
    category: 'Operations',
    schedule: 'Daily'
  },
  MARGIN_ANALYZER: {
    id: 'SCAN_MARGIN_ANALYZER',
    name: 'Margin Analyzer',
    description: 'Pricing gaps and cost reduction opportunities',
    category: 'Financial',
    schedule: 'Daily'
  },
  CUSTOMER_INTEL: {
    id: 'SCAN_CUSTOMER_INTEL',
    name: 'Customer Intelligence',
    description: 'Buying patterns, churn risk, and upsell opportunities',
    category: 'Sales',
    schedule: 'Every 6 hours'
  },
  SUPPLY_CHAIN: {
    id: 'SCAN_SUPPLY_CHAIN',
    name: 'Supply Chain Analyzer',
    description: 'Vendor diversification and logistics optimization',
    category: 'Operations',
    schedule: 'Weekly'
  },
  COMPETITIVE: {
    id: 'SCAN_COMPETITIVE',
    name: 'Competitive Analysis',
    description: 'Market positioning and competitor move detection',
    category: 'Intelligence',
    schedule: 'Weekly'
  },
  SYSTEM_IMPROVEMENT: {
    id: 'SCAN_SYSTEM_IMPROVEMENT',
    name: 'System Self-Improvement',
    description: 'Platform feature suggestions and optimization opportunities',
    category: 'Systems',
    schedule: 'Weekly'
  },
  GROWTH_DISCOVERY: {
    id: 'SCAN_GROWTH_DISCOVERY',
    name: 'Growth Discovery',
    description: 'Acquisition, expansion, and profit maximization paths',
    category: 'Strategy',
    schedule: 'Bi-weekly'
  },
  KNOWLEDGE_SYNTHESIS: {
    id: 'SCAN_KNOWLEDGE_SYNTHESIS',
    name: 'Knowledge Synthesis',
    description: 'Cross-reference insights and pattern identification',
    category: 'Intelligence',
    schedule: 'Daily'
  },
  TREND_TRACKER: {
    id: 'SCAN_TREND_TRACKER',
    name: 'Trend Tracker',
    description: '15+ key metrics time series and deviation analysis',
    category: 'Analytics',
    schedule: 'Every 6 hours'
  }
}

interface ScanInfo {
  scanId: string
  name: string
  description: string
  category: string
  schedule: string
  lastRun: string | null
  status: string
  findingsCount: number
  nextRun: string
}

// ─── GET HANDLER ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = await checkStaffAuthWithFallback(req)
  if (authError) return authError

  const searchParams = req.nextUrl.searchParams
  const action = searchParams.get('action')
  const scanType = searchParams.get('scan')

  try {
    if (action === 'list') {
      return handleListScans()
    }

    if (action === 'results' && scanType) {
      return handleGetResults(scanType)
    }

    return NextResponse.json(
      { error: 'Invalid action. Use action=list or action=results&scan=SCAN_TYPE' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Scan API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ─── POST HANDLER (Trigger a scan) ───────────────────────────────────────

export async function POST(req: NextRequest) {
  const authError = await checkStaffAuthWithFallback(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const { scan } = body

    if (!scan || !SCAN_TYPES[scan as keyof typeof SCAN_TYPES]) {
      return NextResponse.json(
        { error: `Invalid scan type. Valid types: ${Object.keys(SCAN_TYPES).join(', ')}` },
        { status: 400 }
      )
    }

    const scanKey = scan as keyof typeof SCAN_TYPES
    const scanInfo = SCAN_TYPES[scanKey]
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Create AgentTask record with PENDING status
    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO "AgentTask" (id, "taskType", status, priority, payload, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      taskId,
      `SCAN_${scanKey}`,
      'PENDING',
      'MEDIUM',
      JSON.stringify({ scanId: scanInfo.id, name: scanInfo.name })
    )

    return NextResponse.json({
      success: true,
      taskId,
      scanId: scanInfo.id,
      message: `Scan "${scanInfo.name}" triggered`
    })
  } catch (error) {
    console.error('Scan trigger error:', error)
    return NextResponse.json(
      { error: 'Failed to trigger scan' },
      { status: 500 }
    )
  }
}

// ─── HELPER: List all scans with status ──────────────────────────────────

async function handleListScans() {
  const scans: ScanInfo[] = []

  for (const [key, info] of Object.entries(SCAN_TYPES)) {
    const taskType = `SCAN_${key}`

    // Get last run from AgentTask
    const lastTask = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status, "createdAt", payload FROM "AgentTask"
       WHERE "taskType" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      taskType
    )

    const lastTaskRecord = lastTask?.[0]
    const lastRun = lastTaskRecord?.createdAt
      ? new Date(lastTaskRecord.createdAt).toLocaleString()
      : null
    const taskStatus = lastTaskRecord?.status || 'IDLE'

    // Get findings count from AgentTask results
    const findingsResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM "AgentTask"
       WHERE "taskType" = $1 AND status = 'COMPLETE'`,
      taskType
    )
    const findingsCount = findingsResult?.[0]?.count || 0

    // Compute next run (simplified)
    const nextRun = lastRun ? 'Scheduled' : 'Ready'

    scans.push({
      scanId: info.id,
      name: info.name,
      description: info.description,
      category: info.category,
      schedule: info.schedule,
      lastRun,
      status: taskStatus === 'PENDING' ? 'RUNNING' : taskStatus === 'COMPLETE' ? 'IDLE' : taskStatus,
      findingsCount,
      nextRun
    })
  }

  return NextResponse.json({ scans, total: scans.length })
}

// ─── HELPER: Get recent findings for a scan ──────────────────────────────

async function handleGetResults(scanType: string) {
  const results = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "taskType", status, payload, result, "createdAt" FROM "AgentTask"
     WHERE "taskType" = $1
     ORDER BY "createdAt" DESC
     LIMIT 10`,
    `SCAN_${scanType}`
  )

  const findings = results.map((task) => {
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload
    const result = typeof task.result === 'string' ? JSON.parse(task.result) : task.result

    return {
      id: task.id,
      title: payload?.name || 'Unknown Finding',
      status: task.status,
      severity: result?.severity || 'MEDIUM',
      entity: result?.entity || 'General',
      timestamp: new Date(task.createdAt).toLocaleString(),
      details: result?.summary || 'No details available'
    }
  })

  return NextResponse.json({
    scanType,
    findings,
    total: findings.length
  })
}
