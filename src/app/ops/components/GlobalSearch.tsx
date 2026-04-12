'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SearchItem {
  label: string
  subtitle: string
  href: string
}

interface SearchCategory {
  category: string
  items: SearchItem[]
}

interface SearchResponse {
  results: SearchCategory[]
}

export function GlobalSearch() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout>()
  const flatResultsRef = useRef<SearchItem[]>([])

  // Update flat results array for keyboard navigation
  useEffect(() => {
    flatResultsRef.current = results.flatMap((cat) => cat.items)
  }, [results])

  // Handle keyboard shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
      // Close on Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        setQuery('')
        setResults([])
        setSelectedIndex(-1)
      }
      // Arrow navigation
      if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const maxIndex = flatResultsRef.current.length - 1
        let newIndex = selectedIndex
        if (e.key === 'ArrowDown') {
          newIndex = selectedIndex < maxIndex ? selectedIndex + 1 : 0
        } else {
          newIndex = selectedIndex > 0 ? selectedIndex - 1 : maxIndex
        }
        setSelectedIndex(newIndex)
      }
      // Enter to select
      if (isOpen && e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault()
        const selectedItem = flatResultsRef.current[selectedIndex]
        if (selectedItem) {
          router.push(selectedItem.href)
          setIsOpen(false)
          setQuery('')
          setResults([])
          setSelectedIndex(-1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selectedIndex, router])

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      setSelectedIndex(-1)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/ops/search?q=${encodeURIComponent(searchQuery)}`)
      const data: SearchResponse = await response.json()
      setResults(data.results || [])
      setSelectedIndex(-1)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      setSelectedIndex(-1)

      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Set new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        performSearch(value)
      }, 300)
    },
    [performSearch]
  )

  const handleResultClick = (href: string) => {
    router.push(href)
    setIsOpen(false)
    setQuery('')
    setResults([])
    setSelectedIndex(-1)
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false)
      setQuery('')
      setResults([])
      setSelectedIndex(-1)
    }
  }

  // Count total results for display
  const totalResults = results.reduce((sum, cat) => sum + cat.items.length, 0)

  return (
    <>
      {/* Show hint in top bar - will be added via layout */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded border text-sm transition-colors"
          style={{
            borderColor: 'var(--border-color, #e5e7eb)',
            color: 'var(--text-secondary, #6b7280)',
            backgroundColor: 'transparent',
          }}
          title="Press Cmd+K or Ctrl+K to search"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-xs">
            Search
          </span>
        </button>
      )}

      {/* Search Modal Overlay */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 1000,
            paddingTop: '20vh',
          }}
          onClick={handleOverlayClick}
        >
          {/* Search Modal */}
          <div
            style={{
              width: '90%',
              maxWidth: '600px',
              backgroundColor: '#1a1a2e',
              borderRadius: '8px',
              boxShadow: '0 20px 25px rgba(0, 0, 0, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '70vh',
              overflow: 'hidden',
            }}
          >
            {/* Search Input */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#888' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search jobs, orders, builders, products, vendors, staff..."
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('')
                    setResults([])
                    setSelectedIndex(-1)
                  }}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: '18px',
                  }}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Results Area */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 0',
              }}
            >
              {loading && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#888' }}>
                  <p style={{ fontSize: '14px' }}>Searching...</p>
                </div>
              )}

              {!loading && query.length < 2 && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#888' }}>
                  <p style={{ fontSize: '14px', marginBottom: '12px' }}>Start typing to search</p>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    <p style={{ marginBottom: '8px' }}>Try searching for:</p>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      <li style={{ marginBottom: '4px' }}>Job numbers: JOB-2026-0042</li>
                      <li style={{ marginBottom: '4px' }}>Builder names: ABC Homes</li>
                      <li style={{ marginBottom: '4px' }}>Product SKUs: DOOR-12x36</li>
                      <li>Staff names: John Smith</li>
                    </ul>
                  </div>
                </div>
              )}

              {!loading && query.length >= 2 && totalResults === 0 && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#888' }}>
                  <p style={{ fontSize: '14px' }}>No results found for "{query}"</p>
                  <p style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>Try a different search term</p>
                </div>
              )}

              {!loading && totalResults > 0 && (
                <>
                  {results.map((category, catIndex) => (
                    <div key={category.category} style={{ paddingBottom: '8px' }}>
                      {/* Category Header */}
                      <div
                        style={{
                          padding: '8px 16px 4px 16px',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: '#E67E22',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {category.category}
                      </div>

                      {/* Category Items */}
                      {category.items.map((item, itemIndex) => {
                        const flatIndex = results
                          .slice(0, catIndex)
                          .reduce((sum, cat) => sum + cat.items.length, 0) + itemIndex
                        const isSelected = flatIndex === selectedIndex
                        return (
                          <div
                            key={`${category.category}-${itemIndex}`}
                            onClick={() => handleResultClick(item.href)}
                            style={{
                              padding: '8px 16px',
                              cursor: 'pointer',
                              backgroundColor: isSelected ? 'rgba(230, 126, 34, 0.1)' : 'transparent',
                              borderLeft: isSelected ? '3px solid #E67E22' : '3px solid transparent',
                              paddingLeft: '13px',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                          >
                            <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
                              {item.label}
                            </div>
                            <div style={{ color: '#888', fontSize: '12px', marginTop: '2px' }}>
                              {item.subtitle}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            {!loading && totalResults > 0 && (
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  color: '#666',
                  borderTop: '1px solid #333',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
                <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                  <span>↑↓ to navigate</span>
                  <span>⏎ to select</span>
                  <span>esc to close</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
