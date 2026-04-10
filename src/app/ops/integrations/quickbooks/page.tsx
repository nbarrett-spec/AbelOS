'use client'

import { useState, useEffect } from 'react'

interface QBStats {
  connectionStatus: 'connected' | 'error' | 'configuring'
  queueDepth: number
  syncedBuilders: number
  syncedInvoices: number
  syncedPOs: number
  lastSync?: string
  lastSyncStatus?: string
}

interface QueueItem {
  id: string
  type: 'invoice' | 'payment' | 'customer' | 'bill'
  refId: string
  status: 'pending' | 'processing' | 'synced' | 'failed'
  createdAt: string
  processedAt?: string
  errorMessage?: string
}

interface SyncHistoryItem {
  id: string
  type: string
  status: 'success' | 'failed' | 'partial'
  itemsProcessed: number
  itemsFailed: number
  duration: number
  timestamp: string
}

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  connected: { bg: '#D1FAE5', text: '#047857' },
  error: { bg: '#FEE2E2', text: '#DC2626' },
  configuring: { bg: '#FEF3C7', text: '#D97706' },
  pending: { bg: '#EFF6FF', text: '#0284C7' },
  processing: { bg: '#F3E8FF', text: '#7C3AED' },
  synced: { bg: '#D1FAE5', text: '#059669' },
  failed: { bg: '#FEE2E2', text: '#DC2626' },
  success: { bg: '#D1FAE5', text: '#059669' },
  partial: { bg: '#FEF3C7', text: '#D97706' },
}

export default function QuickBooksPage() {
  const [stats, setStats] = useState<QBStats>({
    connectionStatus: 'configuring',
    queueDepth: 0,
    syncedBuilders: 0,
    syncedInvoices: 0,
    syncedPOs: 0,
  })
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    try {
      const res = await fetch('/api/ops/integrations/quickbooks')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      // Map API response to QBStats interface
      const mappedStats: QBStats = {
        connectionStatus: data.connected ? 'connected' : 'configuring',
        queueDepth: data.queue?.pending || 0,
        syncedBuilders: data.entities?.builders?.synced || 0,
        syncedInvoices: data.entities?.invoices?.synced || 0,
        syncedPOs: data.entities?.purchaseOrders?.synced || 0,
        lastSync: data.lastSync,
        lastSyncStatus: data.syncStatus,
      }

      setStats(mappedStats)
      setQueueItems([]) // No queue item list in API yet
      setSyncHistory(data.syncHistory || [])
    } catch (err) {
      console.error('Error fetching QB data:', err)
      showToast('Failed to load QuickBooks data', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(action: string) {
    setSyncing(action)
    try {
      const res = await fetch('/api/ops/integrations/quickbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error('Action failed')
      const result = await res.json()
      showToast(result.message || `${action} queued successfully`)
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Failed to ${action}`,
        'error'
      )
    } finally {
      setSyncing(null)
    }
  }

  async function downloadQWC() {
    try {
      const res = await fetch('/api/ops/integrations/quickbooks/qwc')
      if (!res.ok) throw new Error('Failed to download')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'AbelBuilder.qwc'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      showToast('QWC file downloaded successfully')
    } catch (err) {
      showToast('Failed to download QWC file', 'error')
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
            border: '4px solid #1B4F72',
            borderTop: '4px solid #E67E22',
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
          QuickBooks Desktop Integration
        </h1>
        <p style={{ fontSize: '14px', color: '#6B7280', marginTop: '8px' }}>
          Sync invoices, payments, customers, and bills with QuickBooks via Web
          Connector
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
        {/* Connection Status */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: `4px solid ${
              stats.connectionStatus === 'connected'
                ? '#10B981'
                : stats.connectionStatus === 'error'
                  ? '#EF4444'
                  : '#F59E0B'
            }`,
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Connection Status
          </p>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#111827',
              marginTop: '8px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                marginRight: '8px',
                backgroundColor:
                  stats.connectionStatus === 'connected'
                    ? '#10B981'
                    : stats.connectionStatus === 'error'
                      ? '#EF4444'
                      : '#F59E0B',
              }}
            />
            {(stats.connectionStatus || '').charAt(0).toUpperCase() +
              (stats.connectionStatus || '').slice(1)}
          </div>
        </div>

        {/* Queue Depth */}
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
            Queue Depth
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.queueDepth}
          </p>
        </div>

        {/* Synced Builders */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #8B5CF6',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Synced Builders
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.syncedBuilders}
          </p>
        </div>

        {/* Synced Invoices */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #06B6D4',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Synced Invoices
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.syncedInvoices}
          </p>
        </div>

        {/* Synced POs */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #EC4899',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Synced POs
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.syncedPOs}
          </p>
        </div>
      </div>

      {/* Download QWC and Action Buttons */}
      <div style={{ marginBottom: '32px' }}>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '20px',
          }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
            Configuration
          </h3>
          <button
            onClick={downloadQWC}
            style={{
              padding: '10px 20px',
              backgroundColor: '#1B4F72',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              marginRight: '12px',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.backgroundColor = '#154360')
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.backgroundColor = '#1B4F72')
            }
          >
            Download .qwc File
          </button>
          <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px' }}>
            Import this file in QuickBooks Web Connector to enable synchronization
          </p>
        </div>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
            Sync Actions
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleAction('queue_invoices')}
              disabled={syncing === 'queue_invoices'}
              style={{
                padding: '10px 20px',
                backgroundColor: '#E67E22',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                cursor: syncing === 'queue_invoices' ? 'default' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: syncing === 'queue_invoices' ? 0.6 : 1,
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => {
                if (syncing !== 'queue_invoices') {
                  e.currentTarget.style.backgroundColor = '#D97706'
                }
              }}
              onMouseOut={(e) => {
                if (syncing !== 'queue_invoices') {
                  e.currentTarget.style.backgroundColor = '#E67E22'
                }
              }}
            >
              {syncing === 'queue_invoices' ? 'Queueing...' : 'Queue All Invoices'}
            </button>
            <button
              onClick={() => handleAction('queue_builders')}
              disabled={syncing === 'queue_builders'}
              style={{
                padding: '10px 20px',
                backgroundColor: '#E67E22',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                cursor: syncing === 'queue_builders' ? 'default' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: syncing === 'queue_builders' ? 0.6 : 1,
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => {
                if (syncing !== 'queue_builders') {
                  e.currentTarget.style.backgroundColor = '#D97706'
                }
              }}
              onMouseOut={(e) => {
                if (syncing !== 'queue_builders') {
                  e.currentTarget.style.backgroundColor = '#E67E22'
                }
              }}
            >
              {syncing === 'queue_builders' ? 'Queueing...' : 'Queue All Builders'}
            </button>
            <button
              onClick={() => handleAction('queue_pos')}
              disabled={syncing === 'queue_pos'}
              style={{
                padding: '10px 20px',
                backgroundColor: '#E67E22',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                cursor: syncing === 'queue_pos' ? 'default' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: syncing === 'queue_pos' ? 0.6 : 1,
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => {
                if (syncing !== 'queue_pos') {
                  e.currentTarget.style.backgroundColor = '#D97706'
                }
              }}
              onMouseOut={(e) => {
                if (syncing !== 'queue_pos') {
                  e.currentTarget.style.backgroundColor = '#E67E22'
                }
              }}
            >
              {syncing === 'queue_pos' ? 'Queueing...' : 'Queue POs'}
            </button>
            <button
              onClick={() => handleAction('retry_failed')}
              disabled={syncing === 'retry_failed'}
              style={{
                padding: '10px 20px',
                backgroundColor: '#1B4F72',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                cursor: syncing === 'retry_failed' ? 'default' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: syncing === 'retry_failed' ? 0.6 : 1,
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => {
                if (syncing !== 'retry_failed') {
                  e.currentTarget.style.backgroundColor = '#154360'
                }
              }}
              onMouseOut={(e) => {
                if (syncing !== 'retry_failed') {
                  e.currentTarget.style.backgroundColor = '#1B4F72'
                }
              }}
            >
              {syncing === 'retry_failed' ? 'Retrying...' : 'Retry Failed'}
            </button>
          </div>
        </div>
      </div>

      {/* Sync Queue Table */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Recent Sync Queue
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
                  Type
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
                  Reference ID
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
                  Created
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
                  Error
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid #E5E7EB' }}>
              {queueItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      textAlign: 'center',
                      padding: '32px 16px',
                      color: '#9CA3AF',
                      fontSize: '14px',
                    }}
                  >
                    No queue items
                  </td>
                </tr>
              ) : (
                queueItems.slice(0, 10).map((item) => (
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
                      {item.type.toUpperCase()}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                      }}
                    >
                      {item.refId}
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
                      {new Date(item.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '13px',
                        color: '#DC2626',
                      }}
                    >
                      {item.errorMessage || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Sync History */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Recent Sync History
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
                  Sync Type
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
                  Failed
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
                  Duration
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
                  Timestamp
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid #E5E7EB' }}>
              {syncHistory.length === 0 ? (
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
                    No sync history yet
                  </td>
                </tr>
              ) : (
                syncHistory.slice(0, 10).map((item) => (
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
                      {item.type}
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
                        color: item.itemsFailed > 0 ? '#DC2626' : '#374151',
                        textAlign: 'center',
                        fontWeight: item.itemsFailed > 0 ? '500' : 'normal',
                      }}
                    >
                      {item.itemsFailed}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                        textAlign: 'center',
                      }}
                    >
                      {(item.duration / 1000).toFixed(1)}s
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
                      {new Date(item.timestamp).toLocaleDateString('en-US', {
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
