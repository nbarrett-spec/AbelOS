'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

interface BundleProduct {
  id: string
  sku: string
  name: string
  displayName: string | null
  category: string
  basePrice: number
  builderPrice: number
  priceSource: string
  imageUrl: string | null
  thumbnailUrl: string | null
  stock: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}

interface Bundle {
  id: string
  name: string
  description: string
  items: BundleProduct[]
  individualTotal: number
  bundlePrice: number
  savings: number
  savingsPercent: number
}

function fmtPrice(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function catIcon(cat: string): string {
  const lower = cat.toLowerCase()
  if (lower.includes('door')) return '🚪'
  if (lower.includes('hardware') || lower.includes('handle') || lower.includes('hinge')) return '🔧'
  if (lower.includes('frame')) return '📐'
  if (lower.includes('shelving') || lower.includes('shelf')) return '📦'
  if (lower.includes('lock') || lower.includes('deadbolt')) return '🔐'
  if (lower.includes('weather') || lower.includes('seal')) return '🛡️'
  return '📦'
}

function Placeholder({ cat }: { cat: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0f2a3e" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  )
}

export default function ProductBundles() {
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchBundles() {
      setLoading(true)
      try {
        const res = await fetch('/api/catalog/bundles')
        if (res.ok) {
          const data = await res.json()
          setBundles(data.bundles || [])
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Failed to fetch bundles:', err)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchBundles()
  }, [])

  const displayBundles = bundles.slice(0, 3)

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#9ca3af' }}>
        Loading bundles...
      </div>
    )
  }

  if (displayBundles.length === 0) {
    return null
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: '#0f2a3e',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        ⭐ Popular Bundles
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
        }}
      >
        {displayBundles.map((bundle) => (
          <div
            key={bundle.id}
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              transition: 'all 0.3s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'
              el.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'
              el.style.transform = 'translateY(0)'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 16,
                borderBottom: '1px solid #f3f4f6',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#0f2a3e',
                    margin: '0 0 4px',
                  }}
                >
                  {bundle.name}
                </h3>
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                  {bundle.description}
                </p>
              </div>
              <div
                style={{
                  backgroundColor: '#C6A24E',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 20,
                  whiteSpace: 'nowrap',
                  marginLeft: 8,
                }}
              >
                Save {bundle.savingsPercent}%
              </div>
            </div>

            {/* Product thumbnails */}
            <div
              style={{
                padding: 12,
                backgroundColor: '#f9fafb',
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              {bundle.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 8,
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                  title={item.name}
                >
                  {item.imageUrl ? (
                    <Image
                      src={item.thumbnailUrl || item.imageUrl}
                      alt={item.name}
                      width={60}
                      height={60}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <Placeholder cat={item.category} />
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      fontSize: 11,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      borderRadius: 3,
                      padding: '1px 4px',
                    }}
                  >
                    ×1
                  </div>
                </div>
              ))}
            </div>

            {/* Pricing */}
            <div style={{ padding: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
                    Individual Total
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#9ca3af',
                      textDecoration: 'line-through',
                    }}
                  >
                    {fmtPrice(bundle.individualTotal)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: '#27ae60', fontWeight: 600 }}>
                    Bundle Price
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: '#0f2a3e',
                    }}
                  >
                    {fmtPrice(bundle.bundlePrice)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: '#27ae60',
                  fontWeight: 600,
                  marginBottom: 12,
                  textAlign: 'center',
                  padding: '6px',
                  backgroundColor: '#ecfdf5',
                  borderRadius: 6,
                }}
              >
                You save {fmtPrice(bundle.savings)} ({bundle.savingsPercent}% off)
              </div>

              {/* Expandable items list */}
              {expandedBundleId === bundle.id && (
                <div
                  style={{
                    marginBottom: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #f3f4f6',
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                    Included Items:
                  </div>
                  {bundle.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        paddingBottom: 6,
                        marginBottom: 6,
                        borderBottom: '1px solid #f3f4f6',
                      }}
                    >
                      <span style={{ color: '#4b5563' }}>
                        {catIcon(item.category)} {item.displayName || item.name}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: '#0f2a3e',
                        }}
                      >
                        {fmtPrice(item.builderPrice || item.basePrice)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() =>
                  setExpandedBundleId(expandedBundleId === bundle.id ? null : bundle.id)
                }
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  marginBottom: 8,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#f9fafb',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#0f2a3e',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.backgroundColor = '#f3f4f6'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.backgroundColor = '#f9fafb'
                }}
              >
                {expandedBundleId === bundle.id ? '▼ Hide Items' : '▶ View Items'}
              </button>

              <button
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#0f2a3e',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.backgroundColor = '#153d56'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.backgroundColor = '#0f2a3e'
                }}
              >
                Add Bundle to Cart
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
