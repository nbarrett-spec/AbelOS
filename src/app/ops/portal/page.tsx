'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PortalSummary {
  pm: { openJobs: number; pendingNotes: number; upcomingDeliveries: number }
  purchasing: { posPendingApproval: number; lowStockItems: number }
  warehouse: { todayPickLists: number; productionQueue: number; qcChecksNeeded: number }
  delivery: { todayDeliveries: number; upcomingDeliveriesThreeDays: number }
  accounting: { outstandingInvoices: number; overdueInvoices: number; pendingPOs: number }
}

const portals = [
  {
    id: 'pm',
    title: 'PM Portal',
    description: 'Project management, job tracking, and delivery scheduling',
    icon: '👷',
    href: '/ops/portal/pm',
    color: 'from-[#1B4F72] to-[#154360]',
    countKey: 'pm',
    countField: 'openJobs',
  },
  {
    id: 'purchasing',
    title: 'Purchasing Portal',
    description: 'Purchase orders, vendor management, and inventory',
    icon: '📋',
    href: '/ops/portal/purchasing',
    color: 'from-[#E67E22] to-[#D35400]',
    countKey: 'purchasing',
    countField: 'posPendingApproval',
  },
  {
    id: 'warehouse',
    title: 'Warehouse & Manufacturing',
    description: 'Pick lists, production queue, QC checks, and staging',
    icon: '📦',
    href: '/ops/portal/warehouse',
    color: 'from-[#27AE60] to-[#229954]',
    countKey: 'warehouse',
    countField: 'todayPickLists',
  },
  {
    id: 'delivery',
    title: 'Delivery & Logistics',
    description: 'Route planning, crew assignments, and delivery tracking',
    icon: '🚚',
    href: '/ops/portal/delivery',
    color: 'from-[#3498DB] to-[#2980B9]',
    countKey: 'delivery',
    countField: 'todayDeliveries',
  },
  {
    id: 'accounting',
    title: 'Accounting Portal',
    description: 'Invoices, payments, AR/AP management, and financial tracking',
    icon: '💰',
    href: '/ops/portal/accounting',
    color: 'from-[#8E44AD] to-[#7D3C98]',
    countKey: 'accounting',
    countField: 'outstandingInvoices',
  },
]

export default function PortalSelector() {
  const [summary, setSummary] = useState<PortalSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSummary() {
      try {
        const res = await fetch('/api/ops/portal/summary')
        if (res.ok) {
          const data = await res.json()
          setSummary(data)
        }
      } catch (error) {
        console.error('Failed to load portal summary:', error)
      } finally {
        setLoading(false)
      }
    }
    loadSummary()
  }, [])

  const getCount = (portal: typeof portals[0]) => {
    if (!summary) return 0
    const data = summary[portal.countKey as keyof PortalSummary]
    return data[portal.countField as keyof typeof data] || 0
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Department Portals</h1>
        <p className="text-gray-600 mt-2">
          Select your department to access specialized tools and dashboards
        </p>
      </div>

      {/* Portal cards grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {portals.map((portal) => {
            const count = getCount(portal)
            return (
              <Link key={portal.id} href={portal.href}>
                <div className="h-full bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all cursor-pointer group">
                  {/* Header with gradient background */}
                  <div className={`bg-gradient-to-br ${portal.color} p-6 text-white`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-white/80">Department</p>
                        <h2 className="text-2xl font-bold mt-1">{portal.title}</h2>
                      </div>
                      <div className="text-4xl opacity-80 group-hover:opacity-100 transition-opacity">
                        {portal.icon}
                      </div>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-6">
                    <p className="text-gray-600 text-sm mb-4">{portal.description}</p>

                    {/* Pending count badge */}
                    <div className="mb-4">
                      {count > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 font-bold text-sm">
                            {count}
                          </span>
                          <span className="text-sm text-gray-600">
                            {portal.countField.includes('Job')
                              ? 'pending items'
                              : portal.countField.includes('PO')
                              ? 'awaiting action'
                              : 'awaiting action'}
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">All caught up!</div>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="pt-4 border-t border-gray-100">
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                        Quick Stats
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        {portal.id === 'pm' && summary && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Open Jobs</span>
                              <span className="font-semibold text-gray-900">{summary.pm.openJobs}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Upcoming Deliveries</span>
                              <span className="font-semibold text-gray-900">{summary.pm.upcomingDeliveries}</span>
                            </div>
                          </>
                        )}
                        {portal.id === 'purchasing' && summary && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Low Stock Items</span>
                              <span className="font-semibold text-gray-900">{summary.purchasing.lowStockItems}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Pending Approval</span>
                              <span className="font-semibold text-gray-900">{summary.purchasing.posPendingApproval}</span>
                            </div>
                          </>
                        )}
                        {portal.id === 'warehouse' && summary && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Production Queue</span>
                              <span className="font-semibold text-gray-900">{summary.warehouse.productionQueue}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">QC Needed</span>
                              <span className="font-semibold text-gray-900">{summary.warehouse.qcChecksNeeded}</span>
                            </div>
                          </>
                        )}
                        {portal.id === 'delivery' && summary && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Today's Routes</span>
                              <span className="font-semibold text-gray-900">{summary.delivery.todayDeliveries}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Next 3 Days</span>
                              <span className="font-semibold text-gray-900">{summary.delivery.upcomingDeliveriesThreeDays}</span>
                            </div>
                          </>
                        )}
                        {portal.id === 'accounting' && summary && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Outstanding</span>
                              <span className="font-semibold text-gray-900">{summary.accounting.outstandingInvoices}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Overdue</span>
                              <span className="font-semibold text-red-600">{summary.accounting.overdueInvoices}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer CTA */}
                  <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                    <button className="w-full py-2 px-3 bg-white text-gray-900 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors text-sm font-medium">
                      Access Portal →
                    </button>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
