'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface OverdueInvoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName: string
  builderContact: string | null
  total: number
  balanceDue: number
  status: string
  dueDate: string
  createdAt: string
  daysOverdue: number
  agingBucket: string
  lastAction: {
    actionType: string
    channel: string
    sentAt: string
    notes: string | null
  } | null
}

interface CollectionRule {
  id: string
  name: string
  daysOverdue: number
  actionType: string
  channel: string
  isActive: boolean
}

interface SummaryStats {
  totalOverdueAmount: number
  countByBucket: Record<string, number>
  totalOverdueInvoices: number
  actionsThisMonth: number
}

const NAVY = '#1B4F72'
const ORANGE = '#E67E22'

export default function CollectionsPage() {
  const { addToast } = useToast()
  const [summary, setSummary] = useState<SummaryStats | null>(null)
  const [invoices, setInvoices] = useState<OverdueInvoice[]>([])
  const [rules, setRules] = useState<CollectionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [bucket, setBucket] = useState<string | null>(null)
  const [processingCycle, setProcessingCycle] = useState(false)
  const [cycleMessage, setCycleMessage] = useState('')

  // Load collections data
  useEffect(() => {
    loadCollectionsData()
  }, [page, bucket])

  const loadCollectionsData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', '20')
      if (bucket) params.append('bucket', bucket)

      const res = await fetch(`/api/ops/collections?${params.toString()}`)
      const data = await res.json()
      setSummary(data.summary)
      setInvoices(data.data || [])
      setTotalPages(data.pagination?.pages || 1)

      // Load rules
      const rulesRes = await fetch('/api/ops/collections/rules')
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        setRules(rulesData.rules || [])
      }
    } catch (err) {
      console.error('Failed to load collections data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (invoiceId: string, actionType: string) => {
    try {
      const res = await fetch('/api/ops/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId,
          actionType,
          channel: 'EMAIL',
          notes: `Action taken from dashboard: ${actionType}`,
        }),
      })
      if (res.ok) {
        addToast({ type: 'success', title: 'Action Recorded', message: `${actionType} recorded successfully` })
        loadCollectionsData()
      } else {
        addToast({ type: 'error', title: 'Error', message: 'Failed to record action' })
      }
    } catch (err) {
      console.error('Action error:', err)
      addToast({ type: 'error', title: 'Error', message: 'Error recording action' })
    }
  }

  const handleRunCycle = async () => {
    setProcessingCycle(true)
    setCycleMessage('')
    try {
      const res = await fetch('/api/ops/collections/run-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      setCycleMessage(
        `Cycle completed: ${data.actionsCreated} actions created from ${data.invoicesProcessed} overdue invoices`
      )
      loadCollectionsData()
    } catch (err) {
      setCycleMessage('Error running collection cycle')
      console.error('Cycle error:', err)
    } finally {
      setProcessingCycle(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading collections dashboard...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              Collections Dashboard
            </h1>
            <p style={{ fontSize: '14px', color: '#ccc', margin: '0' }}>
              Manage overdue invoices, track aging, and execute collection workflows
            </p>
          </div>
          <button
            onClick={handleRunCycle}
            disabled={processingCycle}
            style={{
              backgroundColor: ORANGE,
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: processingCycle ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              opacity: processingCycle ? 0.6 : 1,
            }}
          >
            {processingCycle ? 'Running...' : 'Run Collection Cycle'}
          </button>
        </div>
      </div>

      {cycleMessage && (
        <div
          style={{
            backgroundColor: '#d4edda',
            color: '#155724',
            padding: '12px 40px',
            marginBottom: '20px',
            borderLeft: `4px solid #28a745`,
          }}
        >
          {cycleMessage}
        </div>
      )}

      {/* Top Stats Bar */}
      <div style={{ padding: '0 40px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
            Total Overdue Amount
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: NAVY }}>
            ${summary?.totalOverdueAmount.toFixed(2) || '0.00'}
          </div>
        </div>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
            Total Overdue Invoices
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: ORANGE }}>
            {summary?.totalOverdueInvoices || 0}
          </div>
        </div>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
            Actions This Month
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: NAVY }}>
            {summary?.actionsThisMonth || 0}
          </div>
        </div>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
            Collection Rate
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#27ae60' }}>
            {((summary?.countByBucket['1-30'] || 0) / (summary?.totalOverdueInvoices || 1) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Aging Buckets */}
      <div style={{ padding: '0 40px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '15px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: bucket === '1-30' ? `${NAVY}20` : 'white',
              borderColor: bucket === '1-30' ? NAVY : '#ddd',
            }}
            onClick={() => {
              setBucket(bucket === '1-30' ? null : '1-30')
              setPage(1)
            }}
          >
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>1-30 Days</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: NAVY }}>
              {summary?.countByBucket['1-30'] || 0}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>invoices</div>
          </div>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '15px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: bucket === '31-60' ? `${NAVY}20` : 'white',
              borderColor: bucket === '31-60' ? NAVY : '#ddd',
            }}
            onClick={() => {
              setBucket(bucket === '31-60' ? null : '31-60')
              setPage(1)
            }}
          >
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>31-60 Days</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: ORANGE }}>
              {summary?.countByBucket['31-60'] || 0}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>invoices</div>
          </div>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '15px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: bucket === '60plus' ? `${NAVY}20` : 'white',
              borderColor: bucket === '60plus' ? NAVY : '#ddd',
            }}
            onClick={() => {
              setBucket(bucket === '60plus' ? null : '60plus')
              setPage(1)
            }}
          >
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>60+ Days</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#c0392b' }}>
              {summary?.countByBucket['60plus'] || 0}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>invoices</div>
          </div>
        </div>
      </div>

      {/* Overdue Invoices Table */}
      <div style={{ padding: '0 40px 20px' }}>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: NAVY }}>
              Overdue Invoices {bucket ? `(${bucket} Days)` : ''}
            </h2>
          </div>

          {invoices.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No overdue invoices in this period
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                        Invoice
                      </th>
                      <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                        Builder
                      </th>
                      <th style={{ padding: '12px 15px', textAlign: 'right', fontSize: '13px', fontWeight: '600' }}>
                        Amount
                      </th>
                      <th style={{ padding: '12px 15px', textAlign: 'right', fontSize: '13px', fontWeight: '600' }}>
                        Days Overdue
                      </th>
                      <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                        Last Action
                      </th>
                      <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '12px 15px', fontSize: '13px', fontWeight: '500' }}>
                          {inv.invoiceNumber}
                        </td>
                        <td style={{ padding: '12px 15px', fontSize: '13px' }}>
                          <div style={{ fontWeight: '500', color: NAVY }}>{inv.builderName || 'Unknown'}</div>
                          {inv.builderContact && (
                            <div style={{ fontSize: '12px', color: '#999' }}>{inv.builderContact}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 15px', fontSize: '13px', textAlign: 'right', fontWeight: '600' }}>
                          ${inv.balanceDue.toFixed(2)}
                        </td>
                        <td
                          style={{
                            padding: '12px 15px',
                            fontSize: '13px',
                            textAlign: 'right',
                            fontWeight: '600',
                            color: inv.daysOverdue > 60 ? '#c0392b' : inv.daysOverdue > 30 ? ORANGE : '#27ae60',
                          }}
                        >
                          {inv.daysOverdue}
                        </td>
                        <td style={{ padding: '12px 15px', fontSize: '12px' }}>
                          {inv.lastAction ? (
                            <div>
                              <div style={{ fontWeight: '500', color: NAVY }}>{inv.lastAction.actionType}</div>
                              <div style={{ fontSize: '11px', color: '#999' }}>
                                {new Date(inv.lastAction.sentAt).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#999' }}>No action</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 15px', fontSize: '12px' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => handleAction(inv.id, 'REMINDER')}
                              style={{
                                backgroundColor: '#3498db',
                                color: 'white',
                                border: 'none',
                                padding: '5px 10px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '11px',
                              }}
                            >
                              Reminder
                            </button>
                            <button
                              onClick={() => handleAction(inv.id, 'PHONE_CALL')}
                              style={{
                                backgroundColor: '#9b59b6',
                                color: 'white',
                                border: 'none',
                                padding: '5px 10px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '11px',
                              }}
                            >
                              Call
                            </button>
                            <button
                              onClick={() => handleAction(inv.id, 'PAYMENT_PLAN')}
                              style={{
                                backgroundColor: '#27ae60',
                                color: 'white',
                                border: 'none',
                                padding: '5px 10px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '11px',
                              }}
                            >
                              Plan
                            </button>
                            {inv.daysOverdue > 60 && (
                              <button
                                onClick={() => handleAction(inv.id, 'ACCOUNT_HOLD')}
                                style={{
                                  backgroundColor: '#c0392b',
                                  color: 'white',
                                  border: 'none',
                                  padding: '5px 10px',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                }}
                              >
                                Hold
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div
                style={{
                  padding: '15px',
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '10px',
                  borderTop: '1px solid #eee',
                }}
              >
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: page === 1 ? '#eee' : NAVY,
                    color: page === 1 ? '#999' : 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: page === 1 ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Prev
                </button>
                <span style={{ fontSize: '12px', color: '#666', padding: '6px 12px' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: page === totalPages ? '#eee' : NAVY,
                    color: page === totalPages ? '#999' : 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: page === totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Collection Rules */}
      <div style={{ padding: '0 40px 40px' }}>
        <div
          style={{
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: NAVY }}>
              Collection Rules
            </h2>
          </div>

          {rules.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No collection rules configured
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                      Rule Name
                    </th>
                    <th style={{ padding: '12px 15px', textAlign: 'center', fontSize: '13px', fontWeight: '600' }}>
                      Days Overdue
                    </th>
                    <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                      Action Type
                    </th>
                    <th style={{ padding: '12px 15px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>
                      Channel
                    </th>
                    <th style={{ padding: '12px 15px', textAlign: 'center', fontSize: '13px', fontWeight: '600' }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px 15px', fontSize: '13px', fontWeight: '500' }}>
                        {rule.name}
                      </td>
                      <td style={{ padding: '12px 15px', fontSize: '13px', textAlign: 'center' }}>
                        {rule.daysOverdue}+
                      </td>
                      <td style={{ padding: '12px 15px', fontSize: '13px' }}>
                        <span
                          style={{
                            backgroundColor: `${NAVY}20`,
                            color: NAVY,
                            padding: '3px 8px',
                            borderRadius: '3px',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}
                        >
                          {rule.actionType}
                        </span>
                      </td>
                      <td style={{ padding: '12px 15px', fontSize: '13px' }}>{rule.channel}</td>
                      <td
                        style={{
                          padding: '12px 15px',
                          fontSize: '13px',
                          textAlign: 'center',
                          color: rule.isActive ? '#27ae60' : '#c0392b',
                          fontWeight: '500',
                        }}
                      >
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
