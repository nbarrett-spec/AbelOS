'use client'

import { useState, useEffect } from 'react'

interface PricingStats {
  pendingUpdates: number
  appliedToday: number
  avgCostChange: number
  marginRiskItems: number
}

interface PendingUpdate {
  id: string
  sku: string
  productName: string
  oldCost: number
  newCost: number
  changePercent: number
  currentMargin: number
  newMargin: number
  matchStatus: 'exact' | 'partial' | 'review'
}

interface ImportHistoryItem {
  id: string
  filename: string
  uploadedAt: string
  importedBy: string
  itemsProcessed: number
  itemsApplied: number
  status: 'completed' | 'partial' | 'failed'
}

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  exact: { bg: '#D1FAE5', text: '#047857' },
  partial: { bg: '#FEF3C7', text: '#D97706' },
  review: { bg: '#FEE2E2', text: '#DC2626' },
  completed: { bg: '#D1FAE5', text: '#059669' },
  partial_h: { bg: '#FEF3C7', text: '#D97706' },
  failed: { bg: '#FEE2E2', text: '#DC2626' },
}

export default function SupplierPricingPage() {
  const [stats, setStats] = useState<PricingStats>({
    pendingUpdates: 0,
    appliedToday: 0,
    avgCostChange: 0,
    marginRiskItems: 0,
  })
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([])
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await fetch('/api/ops/integrations/supplier-pricing')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      // Map API response to PricingStats interface
      const mappedStats: PricingStats = {
        pendingUpdates: data.overview?.totalPendingUpdates || 0,
        appliedToday: Math.max(0, (data.changeSummary?.totalUpdates || 0) - (data.overview?.totalPendingUpdates || 0)),
        avgCostChange: data.changeSummary?.avgCostChangePct || 0,
        marginRiskItems: data.priceAlerts?.count || 0,
      }

      setStats(mappedStats)
      setPendingUpdates(data.priceAlerts?.items || [])
      setImportHistory(data.batchHistory || [])
    } catch (err) {
      console.error('Error fetching pricing data:', err)
      showToast('Failed to load supplier pricing data', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    const file = files[0]
    if (!file.name.endsWith('.csv')) {
      showToast('Please upload a CSV file', 'error')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/ops/integrations/supplier-pricing', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Upload failed')
      const result = await res.json()
      showToast(
        result.message ||
          `Imported ${result.itemsProcessed || 0} price updates`
      )
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to upload file',
        'error'
      )
    } finally {
      setUploading(false)
      setDragActive(false)
    }
  }

  async function handleBulkAction(action: 'approve' | 'reject') {
    setActioning(action)
    try {
      const res = await fetch('/api/ops/integrations/supplier-pricing/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ids: pendingUpdates.map((u) => u.id),
        }),
      })
      if (!res.ok) throw new Error('Action failed')
      const result = await res.json()
      showToast(
        result.message ||
          `${action === 'approve' ? 'Approved' : 'Rejected'} ${result.count || 0} items`
      )
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Failed to ${action}`,
        'error'
      )
    } finally {
      setActioning(null)
    }
  }

  async function handleItemAction(
    itemId: string,
    action: 'approve' | 'reject'
  ) {
    setActioning(itemId)
    try {
      const res = await fetch('/api/ops/integrations/supplier-pricing/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: [itemId] }),
      })
      if (!res.ok) throw new Error('Action failed')
      showToast(`Item ${action === 'approve' ? 'approved' : 'rejected'}`)
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Failed to ${action}`,
        'error'
      )
    } finally {
      setActioning(null)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
        }}
      >
        <div
          style={{
            animation: 'spin 1s linear infinite',
            width: '32px',
            height: '32px',
            border: '4px solid #0f2a3e',
            borderTop: '4px solid #C6A24E',
            borderRadius: '50%',
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>
          Supplier Pricing Feed
        </h1>
        <p style={{ fontSize: '14px', color: '#6B7280', marginTop: '8px' }}>
          Upload price sheets from Boise Cascade and other suppliers to keep
          product costs current
        </p>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        {/* Pending Updates */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #F59E0B',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Pending Updates
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.pendingUpdates}
          </p>
        </div>

        {/* Applied Today */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #10B981',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Applied Today
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.appliedToday}
          </p>
        </div>

        {/* Avg Cost Change % */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #0284C7',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Avg Cost Change %
          </p>
          <p
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: stats.avgCostChange > 0 ? '#DC2626' : '#10B981',
              marginTop: '8px',
            }}
          >
            {stats.avgCostChange > 0 ? '+' : ''}{stats.avgCostChange.toFixed(1)}%
          </p>
        </div>

        {/* Margin Risk Items */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #EF4444',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Margin Risk Items
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.marginRiskItems}
          </p>
        </div>
      </div>

      {/* File Upload Area */}
      <div style={{ marginBottom: '32px' }}>
        <div
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            handleFileUpload(e.dataTransfer.files)
          }}
          onDragOver={(e) => e.preventDefault()}
          style={{
            borderRadius: '12px',
            padding: '40px 20px',
            border: `2px dashed ${dragActive ? '#C6A24E' : '#D1D5DB'}`,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            backgroundColor: dragActive ? '#FEF9F3' : '#FFFFFF',
          }}
        >
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleFileUpload(e.target.files)}
            style={{ display: 'none' }}
            id="csv-upload"
            disabled={uploading}
          />
          <label
            htmlFor="csv-upload"
            style={{ cursor: uploading ? 'default' : 'pointer', display: 'block' }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
            <p style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
              Drop CSV file here or click to select
            </p>
            <p style={{ fontSize: '13px', color: '#6B7280' }}>
              Supported format: CSV with SKU, Cost, Product Name
            </p>
          </label>
          {uploading && (
            <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '12px' }}>
              Uploading...
            </p>
          )}
        </div>
      </div>

      {/* Bulk Actions */}
      {pendingUpdates.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
              Bulk Actions: {pendingUpdates.length} items pending
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => handleBulkAction('approve')}
                disabled={actioning === 'approve'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#10B981',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: actioning === 'approve' ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: actioning === 'approve' ? 0.6 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (actioning !== 'approve') {
                    e.currentTarget.style.backgroundColor = '#059669'
                  }
                }}
                onMouseOut={(e) => {
                  if (actioning !== 'approve') {
                    e.currentTarget.style.backgroundColor = '#10B981'
                  }
                }}
              >
                {actioning === 'approve' ? 'Approving...' : 'Approve All'}
              </button>
              <button
                onClick={() => handleBulkAction('reject')}
                disabled={actioning === 'reject'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#EF4444',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: actioning === 'reject' ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: actioning === 'reject' ? 0.6 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (actioning !== 'reject') {
                    e.currentTarget.style.backgroundColor = '#DC2626'
                  }
                }}
                onMouseOut={(e) => {
                  if (actioning !== 'reject') {
                    e.currentTarget.style.backgroundColor = '#EF4444'
                  }
                }}
              >
                {actioning === 'reject' ? 'Rejecting...' : 'Reject All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Updates Table */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Pending Price Updates
        </h2>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
            }}
          >
            <thead style={{ backgroundColor: '#F9FAFB' }}>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  SKU
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Product Name
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Old Cost
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  New Cost
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Change
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Current Margin
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  New Margin
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Match Status
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid #E5E7EB' }}>
              {pendingUpdates.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      textAlign: 'center',
                      padding: '32px 16px',
                      color: '#9CA3AF',
                      fontSize: '14px',
                    }}
                  >
                    No pending updates
                  </td>
                </tr>
              ) : (
                pendingUpdates.map((update) => (
                  <tr
                    key={update.id}
                    style={{
                      borderBottom: '1px solid #E5E7EB',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.backgroundColor = '#F9FAFB')
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#111827',
                        fontWeight: '500',
                      }}
                    >
                      {update.sku}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                      }}
                    >
                      {update.productName}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                        textAlign: 'center',
                      }}
                    >
                      ${update.oldCost.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#111827',
                        fontWeight: '500',
                        textAlign: 'center',
                      }}
                    >
                      ${update.newCost.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color:
                          update.changePercent > 0
                            ? '#DC2626'
                            : '#10B981',
                        textAlign: 'center',
                        fontWeight: '500',
                      }}
                    >
                      {update.changePercent > 0 ? '+' : ''}
                      {update.changePercent.toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                        textAlign: 'center',
                      }}
                    >
                      {update.currentMargin.toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color:
                          update.newMargin < update.currentMargin
                            ? '#DC2626'
                            : '#10B981',
                        textAlign: 'center',
                        fontWeight:
                          update.newMargin < update.currentMargin
                            ? '500'
                            : 'normal',
                      }}
                    >
                      {update.newMargin.toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '12px',
                          fontWeight: '500',
                          backgroundColor:
                            STATUS_BADGE_COLORS[update.matchStatus]?.bg ||
                            '#F3F4F6',
                          color:
                            STATUS_BADGE_COLORS[update.matchStatus]?.text ||
                            '#6B7280',
                        }}
                      >
                        {(update.matchStatus || '').charAt(0).toUpperCase() +
                          (update.matchStatus || '').slice(1)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() =>
                            handleItemAction(update.id, 'approve')
                          }
                          disabled={
                            actioning === update.id
                          }
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#10B981',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            cursor:
                              actioning === update.id
                                ? 'default'
                                : 'pointer',
                            fontSize: '12px',
                            fontWeight: '500',
                            opacity:
                              actioning === update.id ? 0.6 : 1,
                          }}
                          onMouseOver={(e) => {
                            if (actioning !== update.id) {
                              e.currentTarget.style.backgroundColor =
                                '#059669'
                            }
                          }}
                          onMouseOut={(e) => {
                            if (actioning !== update.id) {
                              e.currentTarget.style.backgroundColor =
                                '#10B981'
                            }
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleItemAction(update.id, 'reject')}
                          disabled={
                            actioning === update.id
                          }
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#EF4444',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            cursor:
                              actioning === update.id
                                ? 'default'
                                : 'pointer',
                            fontSize: '12px',
                            fontWeight: '500',
                            opacity:
                              actioning === update.id ? 0.6 : 1,
                          }}
                          onMouseOver={(e) => {
                            if (actioning !== update.id) {
                              e.currentTarget.style.backgroundColor =
                                '#DC2626'
                            }
                          }}
                          onMouseOut={(e) => {
                            if (actioning !== update.id) {
                              e.currentTarget.style.backgroundColor =
                                '#EF4444'
                            }
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import History */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Import History
        </h2>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
            }}
          >
            <thead style={{ backgroundColor: '#F9FAFB' }}>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Filename
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Uploaded By
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Processed
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Applied
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Date
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid #E5E7EB' }}>
              {importHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: 'center',
                      padding: '32px 16px',
                      color: '#9CA3AF',
                      fontSize: '14px',
                    }}
                  >
                    No import history yet
                  </td>
                </tr>
              ) : (
                importHistory.map((item) => (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #E5E7EB',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.backgroundColor = '#F9FAFB')
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#111827',
                        fontWeight: '500',
                      }}
                    >
                      {item.filename}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                      }}
                    >
                      {item.importedBy}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                        textAlign: 'center',
                      }}
                    >
                      {item.itemsProcessed}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                        textAlign: 'center',
                      }}
                    >
                      {item.itemsApplied}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '12px',
                          fontWeight: '500',
                          backgroundColor:
                            STATUS_BADGE_COLORS[item.status]?.bg ||
                            '#F3F4F6',
                          color:
                            STATUS_BADGE_COLORS[item.status]?.text ||
                            '#6B7280',
                        }}
                      >
                        {(item.status || '').charAt(0).toUpperCase() +
                          (item.status || '').slice(1)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                      }}
                    >
                      {new Date(item.uploadedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: '500',
            backgroundColor: toastType === 'success' ? '#10B981' : '#EF4444',
            zIndex: 50,
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
