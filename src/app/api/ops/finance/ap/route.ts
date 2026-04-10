export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const purchaseOrders = await prisma.$queryRawUnsafe<Array<{ id: string; poNumber: string; vendorId: string; status: string; total: number; expectedDate: Date | null }>>(
      `SELECT id, "poNumber", "vendorId", status, "total", "expectedDate" FROM "PurchaseOrder"`
    )

    const vendors = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; active: boolean }>>(
      `SELECT id, name, active FROM "Vendor"`
    )
    const vendorMap: Record<string, any> = {}

    vendors.forEach((v) => {
      vendorMap[v.id] = {
        id: v.id,
        name: v.name,
        active: v.active,
      }
    })

    // Summary by status
    const openPOSummary = {
      draft: purchaseOrders.filter((po) => po.status === 'DRAFT').length,
      pendingApproval: purchaseOrders.filter((po) => po.status === 'PENDING_APPROVAL').length,
      approved: purchaseOrders.filter((po) => po.status === 'APPROVED').length,
      sent: purchaseOrders.filter((po) => po.status === 'SENT_TO_VENDOR').length,
      received: purchaseOrders.filter((po) => po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED').length,
    }

    // Vendor spend summary
    const vendorSpendMap: Record<string, any> = {}
    purchaseOrders.forEach((po) => {
      if (!vendorSpendMap[po.vendorId]) {
        vendorSpendMap[po.vendorId] = {
          vendorId: po.vendorId,
          vendorName: vendorMap[po.vendorId]?.name || 'Unknown',
          totalPOs: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          status: vendorMap[po.vendorId]?.active ? 'active' : 'inactive',
        }
      }

      vendorSpendMap[po.vendorId].totalPOs++

      // Received POs are considered paid
      if (po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED') {
        vendorSpendMap[po.vendorId].paidAmount += Number(po.total)
      } else {
        vendorSpendMap[po.vendorId].outstandingAmount += Number(po.total)
      }
    })

    const vendorSpend = Object.values(vendorSpendMap).sort((a: any, b: any) => b.outstandingAmount - a.outstandingAmount)

    // Get PO item counts
    const poItemCounts = await prisma.$queryRawUnsafe<Array<{ poId: string; itemCount: number }>>(
      `SELECT "purchaseOrderId" as "poId", COUNT(*)::int as "itemCount" FROM "PurchaseOrderItem" GROUP BY "purchaseOrderId"`
    )
    const itemCountMap: Record<string, number> = {}
    poItemCounts.forEach((count) => {
      itemCountMap[count.poId] = Number(count.itemCount)
    })

    // PO list with details
    const poList = purchaseOrders
      .filter((po) => po.status !== 'CANCELLED')
      .map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        vendorId: po.vendorId,
        vendorName: vendorMap[po.vendorId]?.name || 'Unknown',
        amount: Number(po.total),
        status: po.status,
        expectedDate: po.expectedDate?.toISOString() || null,
        items: itemCountMap[po.id] || 0,
      }))

    // Bill pay queue (approved + received)
    const billPayQueue = purchaseOrders
      .filter((po) => (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED') && po.expectedDate && po.expectedDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      .map((po) => ({
        poNumber: po.poNumber,
        vendorName: vendorMap[po.vendorId]?.name || 'Unknown',
        amount: Number(po.total),
        expectedDate: po.expectedDate?.toISOString() || '',
      }))
      .sort((a, b) => new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime())

    return NextResponse.json(
      {
        openPOSummary,
        vendorSpend,
        purchaseOrders: poList,
        billPayQueue: billPayQueue.slice(0, 15),
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('AP API error:', error)
    return NextResponse.json({ error: 'Failed to fetch AP data' }, { status: 500 })
  }
}
