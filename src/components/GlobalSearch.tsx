'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SearchResult {
  icon: string
  label: string
  subtitle: string
  href: string
  type: string
  total?: number
}

interface GroupedResults {
  products: SearchResult[]
  orders: SearchResult[]
  projects: SearchResult[]
  invoices: SearchResult[]
}

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [groupedResults, setGroupedResults] = useState<GroupedResults>({
    products: [],
    orders: [],
    projects: [],
    invoices: [],
  })
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setGroupedResults({ products: [], orders: [], projects: [], invoices: [] })
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        const allResults: SearchResult[] = data.results || []
        setResults(allResults)

        // Group by type
        const grouped: GroupedResults = {
          products: allResults.filter((r) => r.type === 'product'),
          orders: allResults.filter((r) => r.type === 'order'),
          projects: allResults.filter((r) => r.type === 'project'),
          invoices: allResults.filter((r) => r.type === 'invoice'),
        }
        setGroupedResults(grouped)
        setSelectedIndex(0)
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Search error:', err)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 250)
    return () => clearTimeout(timer)
  }, [query, doSearch])

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle keyboard navigation
  const allResultsFlat = [
    ...groupedResults.products,
    ...groupedResults.orders,
    ...groupedResults.projects,
    ...groupedResults.invoices,
  ]

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < allResultsFlat.length - 1 ? prev + 1 : prev
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
          break
        case 'Enter':
          e.preventDefault()
          if (allResultsFlat[selectedIndex]) {
            handleResultClick(allResultsFlat[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [isOpen, selectedIndex, allResultsFlat])

  function handleResultClick(result: SearchResult) {
    setIsOpen(false)
    setQuery('')
    setResults([])
    router.push(result.href)
  }

  function fmtCurrency(n: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n)
  }

  return (
    <div ref={searchRef} style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
      {/* Search input */}
      <button
        onClick={() => {
          setIsOpen(true)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #d1d5db',
          backgroundColor: '#f9fafb',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          if (!isOpen) el.style.backgroundColor = '#f3f4f6'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          if (!isOpen) el.style.backgroundColor = '#f9fafb'
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: '#9ca3af' }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Search...</span>
      </button>

      {/* Search dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 8,
            backgroundColor: '#fff',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
            zIndex: 50,
            overflow: 'hidden',
            maxHeight: '500px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Input bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 14px',
              borderBottom: '1px solid #f3f4f6',
              backgroundColor: '#f9fafb',
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: '#9ca3af', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              aria-label="Search products, orders, projects, or invoices"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, orders, projects, invoices..."
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                backgroundColor: 'transparent',
                color: '#1f2937',
              }}
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 16,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Results */}
          <div
            style={{
              overflowY: 'auto',
              maxHeight: '420px',
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: '#9ca3af',
                }}
              >
                Searching...
              </div>
            ) : query.length < 2 ? (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: '#9ca3af',
                }}
              >
                Type at least 2 characters to search
              </div>
            ) : allResultsFlat.length === 0 ? (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: '#9ca3af',
                }}
              >
                No results for "{query}"
              </div>
            ) : (
              <>
                {/* Products section */}
                {groupedResults.products.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '8px 14px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: '#9ca3af',
                        letterSpacing: 0.5,
                      }}
                    >
                      Products
                    </div>
                    {groupedResults.products.map((result, idx) => {
                      const globalIdx = idx
                      return (
                        <button
                          type="button"
                          key={`${result.type}-${result.label}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            border: 'none',
                            backgroundColor:
                              selectedIndex === globalIdx ? '#f3f4f6' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            transition: 'background-color 0.1s',
                            borderBottom: '1px solid #f9fafb',
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>
                            {result.icon}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: '#1f2937',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#9ca3af',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.subtitle}
                              {result.total !== undefined &&
                                ` · ${fmtCurrency(result.total)}`}
                            </div>
                          </div>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ color: '#d1d5db', flexShrink: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Orders section */}
                {groupedResults.orders.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '8px 14px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: '#9ca3af',
                        letterSpacing: 0.5,
                      }}
                    >
                      Orders
                    </div>
                    {groupedResults.orders.map((result, idx) => {
                      const globalIdx = groupedResults.products.length + idx
                      return (
                        <button
                          type="button"
                          key={`${result.type}-${result.label}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            border: 'none',
                            backgroundColor:
                              selectedIndex === globalIdx ? '#f3f4f6' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            transition: 'background-color 0.1s',
                            borderBottom: '1px solid #f9fafb',
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>
                            {result.icon}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: '#1f2937',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#9ca3af',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.subtitle}
                              {result.total !== undefined &&
                                ` · ${fmtCurrency(result.total)}`}
                            </div>
                          </div>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ color: '#d1d5db', flexShrink: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Projects section */}
                {groupedResults.projects.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '8px 14px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: '#9ca3af',
                        letterSpacing: 0.5,
                      }}
                    >
                      Projects
                    </div>
                    {groupedResults.projects.map((result, idx) => {
                      const globalIdx =
                        groupedResults.products.length + groupedResults.orders.length + idx
                      return (
                        <button
                          type="button"
                          key={`${result.type}-${result.label}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            border: 'none',
                            backgroundColor:
                              selectedIndex === globalIdx ? '#f3f4f6' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            transition: 'background-color 0.1s',
                            borderBottom: '1px solid #f9fafb',
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>
                            {result.icon}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: '#1f2937',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#9ca3af',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.subtitle}
                            </div>
                          </div>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ color: '#d1d5db', flexShrink: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Invoices section */}
                {groupedResults.invoices.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '8px 14px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: '#9ca3af',
                        letterSpacing: 0.5,
                      }}
                    >
                      Invoices
                    </div>
                    {groupedResults.invoices.map((result, idx) => {
                      const globalIdx =
                        groupedResults.products.length +
                        groupedResults.orders.length +
                        groupedResults.projects.length +
                        idx
                      return (
                        <button
                          type="button"
                          key={`${result.type}-${result.label}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            border: 'none',
                            backgroundColor:
                              selectedIndex === globalIdx ? '#f3f4f6' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            transition: 'background-color 0.1s',
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>
                            {result.icon}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: '#1f2937',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#9ca3af',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {result.subtitle}
                              {result.total !== undefined &&
                                ` · ${fmtCurrency(result.total)}`}
                            </div>
                          </div>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ color: '#d1d5db', flexShrink: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
