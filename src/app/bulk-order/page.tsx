'use client'

import { useState, useRef } from 'react'

interface ParsedItem {
  sku: string
  productId?: string
  name?: string
  price?: number
  requestedQty: number
  stock?: number
  matched: boolean
}

interface ParseResponse {
  parsed: ParsedItem[]
  matchedCount: number
  unmatchedCount: number
}

function fmtPrice(n: number | undefined): string {
  if (n === undefined) return 'N/A'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function BulkOrderPage() {
  const [inputText, setInputText] = useState('')
  const [parsed, setParsed] = useState<ParsedItem[]>([])
  const [matchedCount, setMatchedCount] = useState(0)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingToCart, setAddingToCart] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleParse = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bulk-order/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: inputText }),
      })

      if (res.ok) {
        const data: ParseResponse = await res.json()
        setParsed(data.parsed)
        setMatchedCount(data.matchedCount)
        setUnmatchedCount(data.unmatchedCount)
      } else {
        setError('Failed to parse bulk order')
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Parse error:', err)
      }
      setError('Error parsing bulk order')
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      setInputText(text)
    }
    reader.readAsText(file)
  }

  const handleAddAllMatched = async () => {
    const matched = parsed.filter(item => item.matched && item.productId)

    if (matched.length === 0) {
      setError('No matched items to add')
      return
    }

    setAddingToCart(true)
    setError(null)

    try {
      for (const item of matched) {
        await fetch('/api/catalog/cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: item.productId,
            quantity: item.requestedQty,
            unitPrice: item.price,
            description: item.name,
            sku: item.sku,
          }),
        })
      }
      // Clear after success
      setInputText('')
      setParsed([])
      setMatchedCount(0)
      setUnmatchedCount(0)
      // Optional: Navigate to cart or show success
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Add to cart error:', err)
      }
      setError('Failed to add items to cart')
    } finally {
      setAddingToCart(false)
    }
  }

  const handleDownloadUnmatched = () => {
    const unmatched = parsed.filter(item => !item.matched)
    if (unmatched.length === 0) {
      setError('No unmatched items to download')
      return
    }

    const csv = ['SKU', ...unmatched.map(item => item.sku)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'unmatched_skus.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClear = () => {
    setInputText('')
    setParsed([])
    setMatchedCount(0)
    setUnmatchedCount(0)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const S = {
    page: {
      minHeight: '100vh',
      backgroundColor: '#f5f6fa',
      padding: '24px 32px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as React.CSSProperties,
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
    } as React.CSSProperties,
    header: {
      marginBottom: '32px',
    } as React.CSSProperties,
    title: {
      fontSize: '28px',
      fontWeight: 700,
      color: '#1B4F72',
      margin: '0 0 8px',
    } as React.CSSProperties,
    subtitle: {
      fontSize: '14px',
      color: '#6b7280',
      margin: 0,
    } as React.CSSProperties,
    card: {
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e5e7eb',
      padding: '24px',
      marginBottom: '24px',
    } as React.CSSProperties,
    section: {
      marginBottom: '24px',
    } as React.CSSProperties,
    label: {
      display: 'block',
      fontSize: '13px',
      fontWeight: 600,
      color: '#374151',
      marginBottom: '8px',
      textTransform: 'uppercase' as const,
      letterSpacing: 0.5,
    } as React.CSSProperties,
    textarea: {
      width: '100%',
      padding: '12px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'monospace',
      outline: 'none',
      minHeight: '200px',
      boxSizing: 'border-box' as const,
    } as React.CSSProperties,
    button: (variant: 'primary' | 'secondary' | 'success' | 'danger') => {
      const variants = {
        primary: {
          backgroundColor: '#1B4F72',
          color: '#fff',
        },
        secondary: {
          backgroundColor: '#e5e7eb',
          color: '#374151',
        },
        success: {
          backgroundColor: '#27ae60',
          color: '#fff',
        },
        danger: {
          backgroundColor: '#ef4444',
          color: '#fff',
        },
      }
      return {
        padding: '10px 16px',
        borderRadius: '8px',
        border: 'none',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s',
        ...variants[variant],
      } as React.CSSProperties
    },
    fileInput: {
      display: 'none',
    } as React.CSSProperties,
    fileButton: {
      padding: '10px 16px',
      borderRadius: '8px',
      border: '2px dashed #d1d5db',
      backgroundColor: '#f9fafb',
      color: '#374151',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s',
    } as React.CSSProperties,
    btnGroup: {
      display: 'flex',
      gap: '12px',
      flexWrap: 'wrap' as const,
      marginTop: '16px',
    } as React.CSSProperties,
    summary: {
      padding: '12px 16px',
      backgroundColor: '#f3f4f6',
      borderRadius: '8px',
      marginBottom: '16px',
      fontSize: '13px',
    } as React.CSSProperties,
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      fontSize: '13px',
    } as React.CSSProperties,
    th: {
      textAlign: 'left' as const,
      padding: '10px 12px',
      backgroundColor: '#f9fafb',
      borderBottom: '1px solid #e5e7eb',
      fontWeight: 600,
      color: '#374151',
    } as React.CSSProperties,
    td: {
      padding: '10px 12px',
      borderBottom: '1px solid #f3f4f6',
    } as React.CSSProperties,
    rowError: {
      backgroundColor: '#fee2e2',
    } as React.CSSProperties,
    checkmark: {
      color: '#27ae60',
      fontWeight: 700,
    } as React.CSSProperties,
    xmark: {
      color: '#ef4444',
      fontWeight: 700,
    } as React.CSSProperties,
  }

  return (
    <div style={S.page}>
      <div style={S.container}>
        {/* Header */}
        <div style={S.header}>
          <h1 style={S.title}>Bulk Order Import</h1>
          <p style={S.subtitle}>
            Import multiple products at once by pasting or uploading a spreadsheet
          </p>
        </div>

        {/* Input Card */}
        <div style={S.card}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937', margin: '0 0 16px' }}>
            Step 1: Input Data
          </h2>

          {/* Paste Section */}
          <div style={S.section}>
            <label style={S.label}>Paste Data</label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Paste SKU and quantity from your spreadsheet
Example:
DR-INT-001	50
DR-EXT-002	25

Supports: tabs, commas, or spaces`}
              style={S.textarea}
            />
          </div>

          {/* File Upload Section */}
          <div style={S.section}>
            <label style={S.label}>Or Upload File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFileUpload}
              style={S.fileInput}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={S.fileButton}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.borderColor = '#9ca3af'
                el.style.backgroundColor = '#f3f4f6'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.borderColor = '#d1d5db'
                el.style.backgroundColor = '#f9fafb'
              }}
            >
              📁 Choose CSV, TSV, or TXT file
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div style={{ padding: '12px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '13px', marginTop: '16px' }}>
              {error}
            </div>
          )}

          {/* Parse Button */}
          <div style={S.btnGroup}>
            <button
              onClick={handleParse}
              disabled={!inputText.trim() || loading}
              style={{
                ...S.button('primary'),
                opacity: !inputText.trim() || loading ? 0.5 : 1,
                cursor: !inputText.trim() || loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Parsing...' : '▶ Parse'}
            </button>
            <button
              onClick={handleClear}
              style={S.button('secondary')}
            >
              🗑 Clear
            </button>
          </div>
        </div>

        {/* Results Card */}
        {parsed.length > 0 && (
          <div style={S.card}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937', margin: '0 0 16px' }}>
              Step 2: Review Results
            </h2>

            {/* Summary */}
            <div style={S.summary}>
              <strong>{matchedCount} of {matchedCount + unmatchedCount} items matched</strong>
              {unmatchedCount > 0 && <span style={{ color: '#dc2626' }}> · {unmatchedCount} not found</span>}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ ...S.th, width: '40px' }}></th>
                    <th style={S.th}>SKU</th>
                    <th style={S.th}>Product Name</th>
                    <th style={S.th}>Qty</th>
                    <th style={S.th}>Unit Price</th>
                    <th style={S.th}>Line Total</th>
                    <th style={S.th}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((item, idx) => (
                    <tr
                      key={idx}
                      style={{
                        ...(item.matched ? {} : S.rowError),
                      }}
                    >
                      <td style={S.td}>
                        {item.matched ? (
                          <span style={S.checkmark}>✓</span>
                        ) : (
                          <span style={S.xmark}>✕</span>
                        )}
                      </td>
                      <td style={S.td}>
                        <strong>{item.sku}</strong>
                      </td>
                      <td style={S.td}>
                        {item.matched ? item.name : <span style={{ color: '#dc2626' }}>Not Found</span>}
                      </td>
                      <td style={S.td}>{item.requestedQty}</td>
                      <td style={S.td}>{fmtPrice(item.price)}</td>
                      <td style={S.td}>
                        <strong>
                          {item.price ? fmtPrice(item.price * item.requestedQty) : 'N/A'}
                        </strong>
                      </td>
                      <td style={S.td}>{item.stock !== undefined ? item.stock : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action Buttons */}
            <div style={S.btnGroup}>
              <button
                onClick={handleAddAllMatched}
                disabled={matchedCount === 0 || addingToCart}
                style={{
                  ...S.button('success'),
                  opacity: matchedCount === 0 || addingToCart ? 0.5 : 1,
                  cursor: matchedCount === 0 || addingToCart ? 'not-allowed' : 'pointer',
                }}
              >
                {addingToCart ? 'Adding...' : `✓ Add ${matchedCount} Matched to Cart`}
              </button>
              {unmatchedCount > 0 && (
                <button
                  onClick={handleDownloadUnmatched}
                  style={S.button('secondary')}
                >
                  ⬇ Download Unmatched ({unmatchedCount})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
