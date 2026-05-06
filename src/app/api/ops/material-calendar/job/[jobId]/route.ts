export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/material-calendar/job/:jobId
//
// Full drill-down for a single job: BoM-required vs allocated-to-this-job
// vs allocated-elsewhere vs inventory on-hand vs incoming POs.
//
// Returns one row per required productId with a status matching the
// calendar cell's rollup rules (GREEN / AMBER / RED).
// ──────────────────────────────────────────────────────────────────────────

type RowStatus = 'GREEN' | 'AMBER' | 'RED'

const COVERED_ALLOC_STATUSES = ['RESERVED', 'PICKED'] as const
const INCOMING_PO_STATUSES = ['APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED'] as const

interface IncomingPo {
  poNumber: string
  vendor: string
  expectedDate: string // ISO
  qty: number
}

interface DrillRow {
  productId: string
  sku: string | null
  productName: string | null
  category: string | null
  required: number
  allocated: number                 // to THIS job, RESERVED|PICKED
  onHand: number                    // total physical on hand
  committedElsewhere: number        // allocations on OTHER jobs (reserved|picked)
  incomingPos: IncomingPo[]
  shortfall: number                 // max(0, required - allocated)
  status: RowStatus
}

interface JobDrillResponse {
  asOf: string
  job: {
    id: string
    jobNumber: string
    jobAddress: string | null
    builderName: string
    communityName: string | null
    assignedPMName: string | null
    scheduledDate: string | null
    jobStatus: string
    scopeType: string
    bwpPoNumber: string | null
    hyphenJobId: string | null
    hyphenDeepLink: string | null
  }
  summary: {
    totalRows: number
    greenCount: number
    amberCount: number
    redCount: number
  }
  rows: DrillRow[]
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { jobId } = await params
    if (!jobId) {
      return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    }

    // ── 1. Load job with PM, order ───────────────────────────────────────
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        jobAddress: true,
        builderName: true,
        community: true,
        scheduledDate: true,
        status: true,
        scopeType: true,
        orderId: true,
        bwpPoNumber: true,
        hyphenJobId: true,
        assignedPM: { select: { firstName: true, lastName: true } },
      },
    })
    if (!job) {
      return NextResponse.json({ error: 'job not found' }, { status: 404 })
    }

    // ── 2. OrderItem + BoM explode for required ──────────────────────────
    const orderItems = job.orderId
      ? await prisma.orderItem.findMany({
          where: { orderId: job.orderId },
          select: { productId: true, quantity: true },
        })
      : []

    const topLevelIds = Array.from(
      new Set(orderItems.map(oi => oi.productId).filter((id): id is string => id !== null))
    )
    const bomEntries = topLevelIds.length > 0
      ? await prisma.bomEntry.findMany({
          where: { parentId: { in: topLevelIds } },
          select: { parentId: true, componentId: true, quantity: true },
        })
      : []

    const bomByParent = new Map<string, Array<{ componentId: string; quantity: number }>>()
    for (const be of bomEntries) {
      let arr = bomByParent.get(be.parentId)
      if (!arr) {
        arr = []
        bomByParent.set(be.parentId, arr)
      }
      arr.push({ componentId: be.componentId, quantity: be.quantity })
    }

    const required = new Map<string, number>()
    const add = (pid: string, q: number) =>
      required.set(pid, (required.get(pid) ?? 0) + q)
    for (const oi of orderItems) {
      if (!oi.productId) continue
      add(oi.productId, oi.quantity)
      const kids = bomByParent.get(oi.productId)
      if (kids) for (const k of kids) add(k.componentId, k.quantity * oi.quantity)
    }

    const productIds = Array.from(required.keys())

    if (productIds.length === 0) {
      const emptyResp: JobDrillResponse = {
        asOf: new Date().toISOString(),
        job: {
          id: job.id,
          jobNumber: job.jobNumber,
          jobAddress: job.jobAddress,
          builderName: job.builderName,
          communityName: job.community,
          assignedPMName: job.assignedPM
            ? `${job.assignedPM.firstName} ${job.assignedPM.lastName}`.trim()
            : null,
          scheduledDate: job.scheduledDate?.toISOString() ?? null,
          jobStatus: String(job.status),
          scopeType: String(job.scopeType),
          bwpPoNumber: job.bwpPoNumber,
          hyphenJobId: job.hyphenJobId,
          hyphenDeepLink: buildHyphenDeepLink(job.hyphenJobId, job.bwpPoNumber),
        },
        summary: { totalRows: 0, greenCount: 0, amberCount: 0, redCount: 0 },
        rows: [],
      }
      return NextResponse.json(emptyResp)
    }

    // ── 3. Allocations to THIS job (covered statuses only) ───────────────
    const thisJobAllocs = await prisma.inventoryAllocation.findMany({
      where: {
        jobId: jobId,
        productId: { in: productIds },
        status: { in: COVERED_ALLOC_STATUSES as unknown as any[] },
      },
      select: { productId: true, quantity: true },
    })
    const allocatedToThis = new Map<string, number>()
    for (const a of thisJobAllocs) {
      if (!a.productId) continue
      allocatedToThis.set(a.productId, (allocatedToThis.get(a.productId) ?? 0) + a.quantity)
    }

    // ── 4. Allocations elsewhere (for reference "committed elsewhere") ───
    const elsewhereAllocs = await prisma.inventoryAllocation.groupBy({
      by: ['productId'],
      where: {
        productId: { in: productIds },
        status: { in: COVERED_ALLOC_STATUSES as unknown as any[] },
        NOT: { jobId: jobId },
      },
      _sum: { quantity: true },
    })
    const committedElsewhere = new Map<string, number>()
    for (const g of elsewhereAllocs) {
      if (!g.productId) continue
      committedElsewhere.set(g.productId, g._sum.quantity ?? 0)
    }

    // ── 5. Inventory on hand ─────────────────────────────────────────────
    const invItems = await prisma.inventoryItem.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, onHand: true },
    })
    const onHandByProduct = new Map<string, number>()
    for (const i of invItems) {
      onHandByProduct.set(i.productId, i.onHand)
    }

    // ── 6. Product metadata ──────────────────────────────────────────────
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true, category: true },
    })
    const productMeta = new Map(products.map(p => [p.id, p]))

    // ── 7. Incoming POs for each required product ────────────────────────
    const incomingItems = await prisma.purchaseOrderItem.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: {
          status: { in: INCOMING_PO_STATUSES as unknown as any[] },
          expectedDate: { not: null },
        },
      },
      select: {
        productId: true,
        quantity: true,
        receivedQty: true,
        purchaseOrder: {
          select: {
            poNumber: true,
            expectedDate: true,
            vendor: { select: { name: true } },
          },
        },
      },
    })
    const incomingByProduct = new Map<string, IncomingPo[]>()
    for (const it of incomingItems) {
      if (!it.productId || !it.purchaseOrder?.expectedDate) continue
      const remaining = Math.max(0, it.quantity - it.receivedQty)
      if (remaining <= 0) continue
      const line: IncomingPo = {
        poNumber: it.purchaseOrder.poNumber,
        vendor: it.purchaseOrder.vendor?.name ?? 'Unknown',
        expectedDate: it.purchaseOrder.expectedDate.toISOString(),
        qty: remaining,
      }
      let arr = incomingByProduct.get(it.productId)
      if (!arr) {
        arr = []
        incomingByProduct.set(it.productId, arr)
      }
      arr.push(line)
    }
    for (const arr of incomingByProduct.values()) {
      arr.sort((a, b) => new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime())
    }

    // ── 8. Build rows ────────────────────────────────────────────────────
    const rows: DrillRow[] = []
    const scheduledTs = job.scheduledDate?.getTime() ?? Infinity
    for (const [pid, req] of required.entries()) {
      const meta = productMeta.get(pid)
      const alloc = allocatedToThis.get(pid) ?? 0
      const elsewhere = committedElsewhere.get(pid) ?? 0
      const onHand = onHandByProduct.get(pid) ?? 0
      const shortfall = Math.max(0, req - alloc)
      const pos = incomingByProduct.get(pid) ?? []

      let status: RowStatus
      if (shortfall <= 0) {
        status = 'GREEN'
      } else {
        let cover = 0
        for (const p of pos) {
          if (new Date(p.expectedDate).getTime() <= scheduledTs) {
            cover += p.qty
            if (cover >= shortfall) break
          }
        }
        status = cover >= shortfall ? 'AMBER' : 'RED'
      }

      rows.push({
        productId: pid,
        sku: meta?.sku ?? null,
        productName: meta?.name ?? null,
        category: meta?.category ?? null,
        required: req,
        allocated: alloc,
        onHand,
        committedElsewhere: elsewhere,
        incomingPos: pos,
        shortfall,
        status,
      })
    }

    // Sort: RED first, then AMBER, then GREEN; within each, largest shortfall
    rows.sort((a, b) => {
      const order: Record<RowStatus, number> = { RED: 0, AMBER: 1, GREEN: 2 }
      const o = order[a.status] - order[b.status]
      if (o !== 0) return o
      return b.shortfall - a.shortfall
    })

    const resp: JobDrillResponse = {
      asOf: new Date().toISOString(),
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        jobAddress: job.jobAddress,
        builderName: job.builderName,
        communityName: job.community,
        assignedPMName: job.assignedPM
          ? `${job.assignedPM.firstName} ${job.assignedPM.lastName}`.trim()
          : null,
        scheduledDate: job.scheduledDate?.toISOString() ?? null,
        jobStatus: String(job.status),
        scopeType: String(job.scopeType),
        bwpPoNumber: job.bwpPoNumber,
        hyphenJobId: job.hyphenJobId,
        hyphenDeepLink: buildHyphenDeepLink(job.hyphenJobId, job.bwpPoNumber),
      },
      summary: {
        totalRows: rows.length,
        greenCount: rows.filter(r => r.status === 'GREEN').length,
        amberCount: rows.filter(r => r.status === 'AMBER').length,
        redCount: rows.filter(r => r.status === 'RED').length,
      },
      rows,
    }
    return NextResponse.json(resp)
  } catch (err: any) {
    console.error('[material-calendar/job] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to load job drill-down' },
      { status: 500 }
    )
  }
}

/**
 * Build a best-effort deep link to Hyphen if we have either the Hyphen
 * job id or the builder PO number. The exact URL shape for Hyphen isn't
 * public — this is a guess that routes the user into the BWP portal root
 * with the PO number as a query param, and a hint of the Hyphen id in the
 * hash so it's easy to paste into the real URL scheme once we confirm it.
 * Returns null if we have nothing to key on.
 */
function buildHyphenDeepLink(
  hyphenJobId: string | null | undefined,
  bwpPoNumber: string | null | undefined
): string | null {
  if (!hyphenJobId && !bwpPoNumber) return null
  const base = 'https://portal.hyphensolutions.com/bcp'
  if (hyphenJobId) {
    return `${base}/job/${encodeURIComponent(hyphenJobId)}`
  }
  return `${base}/search?po=${encodeURIComponent(bwpPoNumber ?? '')}`
}
