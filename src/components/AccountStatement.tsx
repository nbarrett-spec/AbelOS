'use client'

import { useState } from 'react'

interface LedgerEntry {
  date: string
  type: 'INVOICE' | 'PAYMENT'
  reference: string
  description: string
  charges: number
  payments: number
  balance: number
}

interface StatementData {
  builder: {
    companyName: string
    contactName: string
    email: string
    phone?: string
    address?: string
    city?: string
    state?: string
  }
  dateRange: {
    startDate: string
    endDate: string
  }
  ledger: LedgerEntry[]
  summary: {
    totalCharges: number
    totalPayments: number
    balanceDue: number
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function AccountStatement() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [format, setFormat] = useState<'view' | 'csv'>('view')
  const [showStatement, setShowStatement] = useState(false)
  const [statement, setStatement] = useState<StatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async (exportFormat: 'csv' | 'json') => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates')
      return
    }

    try {
      setLoading(true)
      setError(null)

      const url = new URL('/api/builder/statement/export', window.location.origin)
      url.searchParams.append('startDate', startDate)
      url.searchParams.append('endDate', endDate)
      url.searchParams.append('format', exportFormat)

      const res = await fetch(url.toString())

      if (!res.ok) {
        throw new Error('Failed to export statement')
      }

      if (exportFormat === 'csv') {
        // Download CSV file
        const blob = await res.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = `statement-${startDate}-to-${endDate}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(downloadUrl)
        document.body.removeChild(a)
      } else {
        // Display JSON statement
        const data = await res.json()
        setStatement(data)
        setShowStatement(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export statement')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <h2 style={{
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#1B4F72',
          marginBottom: '16px',
        }}>
          Account Statement
        </h2>

        {error && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              padding: '12px',
              color: '#991b1b',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}

        {/* Date Range Selection */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#666',
                marginBottom: '6px',
              }}
            >
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setError(null)
              }}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: loading ? '#f5f5f5' : 'white',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#666',
                marginBottom: '6px',
              }}
            >
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setError(null)
              }}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: loading ? '#f5f5f5' : 'white',
              }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => handleExport('csv')}
            disabled={loading || !startDate || !endDate}
            style={{
              padding: '10px 16px',
              backgroundColor: '#E67E22',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor:
                loading || !startDate || !endDate ? 'not-allowed' : 'pointer',
              opacity: loading || !startDate || !endDate ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            📥 Download CSV
          </button>

          <button
            onClick={() => handleExport('json')}
            disabled={loading || !startDate || !endDate}
            style={{
              padding: '10px 16px',
              backgroundColor: '#1B4F72',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor:
                loading || !startDate || !endDate ? 'not-allowed' : 'pointer',
              opacity: loading || !startDate || !endDate ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {showStatement ? '🔄 Refresh' : '📋 View Statement'}
          </button>
        </div>
      </div>

      {/* Statement Display */}
      {showStatement && statement && (
        <div
          style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          {/* Statement Header */}
          <div
            style={{
              backgroundColor: '#1B4F72',
              color: 'white',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 'bold',
                marginBottom: '8px',
              }}
            >
              Abel Lumber
            </h1>
            <p style={{ fontSize: '13px', opacity: 0.9 }}>
              Account Statement
            </p>
          </div>

          {/* Builder Info */}
          <div
            style={{
              padding: '20px',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '24px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#666',
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Account Name
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1f2937',
                    marginBottom: '12px',
                  }}
                >
                  {statement.builder.companyName}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#666',
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Contact
                </div>
                <div style={{ fontSize: '13px', color: '#1f2937' }}>
                  {statement.builder.contactName}
                  <br />
                  {statement.builder.email}
                  {statement.builder.phone && (
                    <>
                      <br />
                      {statement.builder.phone}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#666',
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Period
                </div>
                <div style={{ fontSize: '14px', color: '#1f2937' }}>
                  {formatDate(statement.dateRange.startDate)} to{' '}
                  {formatDate(statement.dateRange.endDate)}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#666',
                    textTransform: 'uppercase',
                    marginTop: '12px',
                    marginBottom: '4px',
                  }}
                >
                  Balance Due
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: statement.summary.balanceDue > 0 ? '#E67E22' : '#16a34a',
                  }}
                >
                  {formatCurrency(statement.summary.balanceDue)}
                </div>
              </div>
            </div>
          </div>

          {/* Ledger Table */}
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#1f2937',
                  }}>
                    Date
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#1f2937',
                  }}>
                    Type
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#1f2937',
                  }}>
                    Reference
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#1f2937',
                  }}>
                    Description
                  </th>
                  <th
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontWeight: '600',
                      color: '#1f2937',
                    }}
                  >
                    Charges
                  </th>
                  <th
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontWeight: '600',
                      color: '#1f2937',
                    }}
                  >
                    Payments
                  </th>
                  <th
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontWeight: '600',
                      color: '#1f2937',
                    }}
                  >
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {statement.ledger.map((entry, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: '1px solid #e5e7eb',
                      backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb',
                    }}
                  >
                    <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                      {formatDate(entry.date)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '500',
                          backgroundColor:
                            entry.type === 'INVOICE'
                              ? '#fef3c7'
                              : '#d1fae5',
                          color:
                            entry.type === 'INVOICE'
                              ? '#92400e'
                              : '#065f46',
                        }}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                      {entry.reference}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        color: '#6b7280',
                      }}
                    >
                      {entry.description}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: entry.charges > 0 ? '#E67E22' : '#9ca3af',
                        fontWeight: entry.charges > 0 ? '500' : '400',
                      }}
                    >
                      {entry.charges > 0
                        ? formatCurrency(entry.charges)
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: entry.payments > 0 ? '#16a34a' : '#9ca3af',
                        fontWeight: entry.payments > 0 ? '500' : '400',
                      }}
                    >
                      {entry.payments > 0
                        ? formatCurrency(entry.payments)
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: '#1f2937',
                        fontWeight: '500',
                      }}
                    >
                      {formatCurrency(entry.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Footer */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderTop: '2px solid #1B4F72',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '24px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#666',
                  marginBottom: '4px',
                }}
              >
                TOTAL CHARGES
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#E67E22',
                }}
              >
                {formatCurrency(statement.summary.totalCharges)}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#666',
                  marginBottom: '4px',
                }}
              >
                TOTAL PAYMENTS
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#16a34a',
                }}
              >
                {formatCurrency(statement.summary.totalPayments)}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#666',
                  marginBottom: '4px',
                }}
              >
                BALANCE DUE
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: statement.summary.balanceDue > 0 ? '#1B4F72' : '#16a34a',
                }}
              >
                {formatCurrency(statement.summary.balanceDue)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
