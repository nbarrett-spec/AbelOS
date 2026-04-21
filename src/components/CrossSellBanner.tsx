'use client'

import { useState, useEffect, useRef } from 'react'

interface Recommendation {
  id: string
  name: string
  sku: string
  price: number
  category: string
  reason: string
}

interface CrossSellBannerProps {
  cartProductIds: string[]
}

function fmtPrice(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function CrossSellBanner({ cartProductIds }: CrossSellBannerProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cartProductIds.length === 0) {
      setRecommendations([])
      return
    }

    const fetchRecommendations = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/recommendations?productIds=${cartProductIds.join(',')}`
        )
        if (res.ok) {
          const data = await res.json()
          setRecommendations(data.recommendations || [])
        } else {
          setError('Failed to load recommendations')
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('CrossSellBanner fetch error:', err)
        }
        setError('Error loading recommendations')
      } finally {
        setLoading(false)
      }
    }

    fetchRecommendations()
  }, [cartProductIds])

  const handleAddToCart = async (rec: Recommendation) => {
    try {
      const res = await fetch('/api/catalog/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: rec.id,
          quantity: 1,
          unitPrice: rec.price,
          description: rec.name,
          sku: rec.sku,
        }),
      })
      if (res.ok) {
        // Optional: Show a brief success message or trigger a toast
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Add to cart error:', err)
      }
    }
  }

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 300
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      })
    }
  }

  if (recommendations.length === 0 && !loading) {
    return null
  }

  return (
    <div
      style={{
        backgroundColor: '#f5f6fa',
        borderTop: '1px solid #e5e7eb',
        padding: '24px 32px',
        marginTop: '32px',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#0f2a3e',
            margin: 0,
          }}
        >
          Builders Also Ordered
        </h3>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0' }}>
          {recommendations.length > 0 && `${recommendations.length} recommendations`}
        </p>
      </div>

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af' }}>
          Loading recommendations...
        </div>
      ) : error ? (
        <div style={{ padding: '16px 0', color: '#ef4444', fontSize: '13px' }}>
          {error}
        </div>
      ) : recommendations.length > 0 ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {/* Left scroll button */}
          <button
            onClick={() => scroll('left')}
            style={{
              position: 'absolute',
              left: 0,
              zIndex: 10,
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0f2a3e',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.backgroundColor = '#0f2a3e'
              el.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.backgroundColor = '#fff'
              el.style.color = '#0f2a3e'
            }}
          >
            ‹
          </button>

          {/* Scrollable container */}
          <div
            ref={scrollContainerRef}
            style={{
              display: 'flex',
              gap: '16px',
              overflowX: 'auto',
              scrollBehavior: 'smooth',
              paddingLeft: '52px',
              paddingRight: '52px',
              scrollSnapType: 'x mandatory',
            }}
          >
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                style={{
                  flexShrink: 0,
                  width: '200px',
                  backgroundColor: '#fff',
                  borderRadius: '10px',
                  border: '1px solid #e5e7eb',
                  padding: '16px',
                  transition: 'all 0.2s',
                  scrollSnapAlign: 'start',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.boxShadow = 'none'
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '12px',
                    backgroundColor: '#C6A24E15',
                    color: '#C6A24E',
                    marginBottom: '8px',
                  }}
                >
                  {rec.reason}
                </span>

                {/* Product name */}
                <h4
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#1f2937',
                    margin: '8px 0 4px',
                    lineHeight: 1.3,
                    minHeight: '32px',
                  }}
                >
                  {rec.name}
                </h4>

                {/* SKU */}
                <p style={{ fontSize: '11px', color: '#9ca3af', margin: '0 0 8px' }}>
                  {rec.sku}
                </p>

                {/* Price */}
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    color: '#0f2a3e',
                    marginBottom: '12px',
                  }}
                >
                  {fmtPrice(rec.price)}
                </div>

                {/* Add to cart button */}
                <button
                  onClick={() => handleAddToCart(rec)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#0f2a3e',
                    color: '#fff',
                    fontSize: '12px',
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
                  Add to Cart
                </button>
              </div>
            ))}
          </div>

          {/* Right scroll button */}
          <button
            onClick={() => scroll('right')}
            style={{
              position: 'absolute',
              right: 0,
              zIndex: 10,
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0f2a3e',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.backgroundColor = '#0f2a3e'
              el.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.backgroundColor = '#fff'
              el.style.color = '#0f2a3e'
            }}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  )
}
