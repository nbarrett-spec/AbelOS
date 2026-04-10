'use client'

import { useState } from 'react'

type ImportType = 'all' | 'vendors' | 'customers' | 'products' | 'stock' | 'vendor-products' | 'bom' | 'purchase-orders' | 'sales-orders'

interface ImportResult {
  imported?: number
  updated?: number
  skipped?: number
  pricingCreated?: number
  ordersCreated?: number
  ordersUpdated?: number
  itemsCreated?: number
  totalOrdersInFile?: number
  errors?: string[]
  error?: string
}

const IMPORT_TYPES: { key: ImportType; label: string; description: string; icon: string; csvFile: string }[] = [
  { key: 'all', label: 'Import Everything', description: 'Run all imports in dependency order', icon: '🔄', csvFile: 'All InFlow CSVs' },
  { key: 'vendors', label: 'Vendors', description: 'Supplier/vendor contacts & details', icon: '🏭', csvFile: 'inFlow_Vendor (4).csv' },
  { key: 'customers', label: 'Customers / Builders', description: 'Builder accounts with payment terms', icon: '👷', csvFile: 'inFlow_Customer (4).csv' },
  { key: 'products', label: 'Products & Pricing', description: 'Product catalog with per-builder prices', icon: '📦', csvFile: 'inFlow_ProductDetails (10).csv' },
  { key: 'stock', label: 'Stock Levels', description: 'Current inventory quantities', icon: '📊', csvFile: 'inFlow_StockLevels (8).csv' },
  { key: 'vendor-products', label: 'Vendor Products', description: 'Vendor SKUs, costs, and lead times', icon: '🔗', csvFile: 'inFlow_VendorProductDetails.csv' },
  { key: 'bom', label: 'Bill of Materials', description: 'Product assembly components', icon: '🔧', csvFile: 'inFlow_BOM (7).csv' },
  { key: 'purchase-orders', label: 'Purchase Orders', description: 'POs with line items from InFlow', icon: '📋', csvFile: 'inFlow_PurchaseOrder (7).csv' },
  { key: 'sales-orders', label: 'Sales Orders', description: 'Customer orders with line items, payment & delivery status', icon: '💰', csvFile: 'inFlow_SalesOrder (15).csv' },
]

export default function ImportsPage() {
  const [running, setRunning] = useState<ImportType | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [results, setResults] = useState<Record<string, any> | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Array<{ type: ImportType; timestamp: string; results: Record<string, any> }>>([])

  async function runCleanup() {
    setCleaning(true)
    setError('')
    setResults(null)

    try {
      const res = await fetch('/api/ops/import-inflow', { method: 'PATCH' })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Cleanup failed')
      } else {
        setResults({ cleanup: true, ...data })
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setCleaning(false)
    }
  }

  async function runImport(importType: ImportType) {
    setRunning(importType)
    setError('')
    setResults(null)

    try {
      const res = await fetch('/api/ops/import-inflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importType }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Import failed')
      } else {
        setResults(data)
        setHistory(prev => [{
          type: importType,
          timestamp: new Date().toLocaleString(),
          results: data,
        }, ...prev])
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setRunning(null)
    }
  }

  function renderResult(key: string, result: ImportResult) {
    if (!result) return null
    if (result.error) {
      return (
        <div key={key} style={{ padding: '0.75rem 1rem', background: '#fef2f2', borderRadius: 8, marginBottom: '0.5rem', border: '1px solid #fecaca' }}>
          <strong style={{ color: '#dc2626' }}>{key}</strong>: {result.error}
        </div>
      )
    }

    const stats: string[] = []
    if (result.imported !== undefined) stats.push(`${result.imported} imported`)
    if (result.updated !== undefined) stats.push(`${result.updated} updated`)
    if (result.ordersCreated !== undefined) stats.push(`${result.ordersCreated} orders created`)
    if (result.ordersUpdated !== undefined && result.ordersUpdated > 0) stats.push(`${result.ordersUpdated} orders updated`)
    if (result.itemsCreated !== undefined) stats.push(`${result.itemsCreated} line items`)
    if (result.totalOrdersInFile !== undefined) stats.push(`${result.totalOrdersInFile} total in file`)
    if (result.pricingCreated !== undefined && result.pricingCreated > 0) stats.push(`${result.pricingCreated} price entries`)
    if (result.skipped !== undefined) stats.push(`${result.skipped} skipped`)

    return (
      <div key={key} style={{ padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: 8, marginBottom: '0.5rem', border: '1px solid #bbf7d0' }}>
        <strong style={{ color: '#16a34a', textTransform: 'capitalize' }}>{key}</strong>: {stats.join(' · ')}
        {result.errors && result.errors.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b45309' }}>
            {result.errors.length} warning(s):
            <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
              {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 5 && <li>...and {result.errors.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1e293b' }}>Data Import Center</h1>
        <p style={{ color: '#64748b', marginTop: '0.25rem' }}>
          Import data from InFlow CSV exports into the Abel Builder Platform
        </p>
      </div>

      {error && (
        <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: '1.5rem', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Import Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {IMPORT_TYPES.map(({ key, label, description, icon, csvFile }) => {
          const isRunning = running === key
          const isAll = key === 'all'

          return (
            <div
              key={key}
              style={{
                background: isAll ? '#1e3a5f' : '#fff',
                color: isAll ? '#fff' : '#1e293b',
                border: isAll ? 'none' : '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                ...(isAll ? { gridColumn: '1 / -1' } : {}),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{icon}</span>
                <div>
                  <h3 style={{ fontWeight: 600, fontSize: isAll ? '1.1rem' : '1rem' }}>{label}</h3>
                  <p style={{ fontSize: '0.8rem', color: isAll ? '#94a3b8' : '#64748b', margin: 0 }}>{description}</p>
                </div>
              </div>
              <p style={{ fontSize: '0.75rem', color: isAll ? '#cbd5e1' : '#94a3b8', margin: 0 }}>
                Source: {csvFile}
              </p>
              <button
                onClick={() => runImport(key)}
                disabled={running !== null}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: running !== null ? 'not-allowed' : 'pointer',
                  background: isAll ? '#e97c1f' : (running !== null ? '#e2e8f0' : '#1e3a5f'),
                  color: running !== null && !isAll ? '#94a3b8' : '#fff',
                  opacity: running !== null && running !== key ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {isRunning ? (
                  <span>⏳ Importing{isAll ? ' all data' : ''}...</span>
                ) : (
                  <span>Run {isAll ? 'Full ' : ''}Import</span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Results */}
      {results && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.5rem', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#16a34a' }}>
            ✅ {results.cleanup ? 'Cleanup' : 'Import'} Complete — {results.timestamp}
          </h2>
          {results.cleanup && (
            <div style={{ padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: 8, marginBottom: '0.5rem', border: '1px solid #bbf7d0' }}>
              <p style={{ margin: '0.25rem 0', color: '#16a34a' }}><strong>Corrupted records removed:</strong> {results.corruptedRemoved}</p>
              <p style={{ margin: '0.25rem 0', color: '#16a34a' }}><strong>Duplicate vendors merged:</strong> {results.vendorsDeduped}</p>
              <p style={{ margin: '0.25rem 0', color: '#16a34a' }}><strong>POs reassigned:</strong> {results.posReassigned}</p>
              <p style={{ margin: '0.25rem 0', color: '#16a34a' }}><strong>Vendors remaining:</strong> {results.vendorsRemaining}</p>
            </div>
          )}
          {results.vendors && renderResult('vendors', results.vendors)}
          {results.customers && renderResult('customers', results.customers)}
          {results.products && renderResult('products', results.products)}
          {results.stock && renderResult('stock', results.stock)}
          {results.vendorProducts && renderResult('vendorProducts', results.vendorProducts)}
          {results.bom && renderResult('bom', results.bom)}
          {results.purchaseOrders && renderResult('purchaseOrders', results.purchaseOrders)}
          {results.salesOrders && renderResult('salesOrders', results.salesOrders)}
        </div>
      )}

      {/* Import History */}
      {history.length > 1 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Import History</h2>
          {history.slice(1).map((h, i) => (
            <div key={i} style={{ padding: '0.75rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem', color: '#475569' }}>
              <strong style={{ textTransform: 'capitalize' }}>{h.type}</strong> — {h.timestamp}
            </div>
          ))}
        </div>
      )}

      {/* Data Cleanup */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.25rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontWeight: 600, fontSize: '1rem', color: '#1e293b', margin: 0 }}>🧹 Data Cleanup</h3>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0' }}>
            Remove duplicate vendors, fix corrupted records, and reassign orphaned POs
          </p>
        </div>
        <button
          onClick={runCleanup}
          disabled={running !== null || cleaning}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: (running !== null || cleaning) ? 'not-allowed' : 'pointer',
            background: cleaning ? '#f1f5f9' : '#fff',
            color: cleaning ? '#94a3b8' : '#dc2626',
            transition: 'all 0.2s',
          }}
        >
          {cleaning ? '⏳ Cleaning...' : 'Run Cleanup'}
        </button>
      </div>

      {/* Info Box */}
      <div style={{ marginTop: '2rem', padding: '1.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: '0.85rem', color: '#475569' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#1e293b' }}>How it works</h3>
        <p style={{ margin: '0.25rem 0' }}>
          The importer reads CSV files exported from InFlow, located in the <strong>In Flow Exports</strong> folder.
          Data is upserted (created or updated) to avoid duplicates. Running the same import twice is safe.
        </p>
        <p style={{ margin: '0.5rem 0 0' }}>
          <strong>Import order matters:</strong> When running "Import Everything", data imports in dependency order —
          vendors and customers first, then products (which link to builders for pricing),
          then stock levels and POs (which reference products and vendors).
        </p>
      </div>
    </div>
  )
}
