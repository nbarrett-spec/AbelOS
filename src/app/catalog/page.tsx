'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback } from 'react'
import { PRODUCT_TAXONOMY } from '@/lib/product-categories'
import ProductBundles from '@/components/ProductBundles'

/* ─────────── types ─────────── */
interface Product {
  id: string
  sku: string
  name: string
  displayName: string | null
  description: string | null
  category: string
  subcategory: string | null
  cleanCategory: string
  cleanSubcategory: string
  basePrice: number
  builderPrice: number
  priceSource: string
  customPrice: number | null
  doorSize: string | null
  handing: string | null
  coreType: string | null
  panelStyle: string | null
  jambSize: string | null
  material: string | null
  fireRating: string | null
  hardwareFinish: string | null
  imageUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string | null
  active: boolean
  stock: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}

/* ─────────── helpers ─────────── */
function fmtPrice(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function catIcon(name: string): string {
  const t = PRODUCT_TAXONOMY.find(c => c.name === name)
  return t?.icon || '📦'
}

function catColor(name: string): string {
  const t = PRODUCT_TAXONOMY.find(c => c.name === name)
  return t?.color || '#9CA3AF'
}

/* ─────────── placeholder SVG ─────────── */
function Placeholder({ cat }: { cat: string }) {
  const color = catColor(cat)
  const lower = cat.toLowerCase()
  if (lower.includes('door')) {
    return (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <circle cx="17" cy="12" r="1" fill={color} />
      </svg>
    )
  }
  if (lower.includes('hardware') || lower.includes('frame') || lower.includes('component')) {
    return (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
      </svg>
    )
  }
  if (lower.includes('trim') || lower.includes('moulding')) {
    return (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <rect x="3" y="6" width="18" height="3" rx="1" />
        <rect x="3" y="12" width="18" height="3" rx="1" />
      </svg>
    )
  }
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [hasPricing, setHasPricing] = useState(false)
  // Inventory feed is "active" once we see at least one IN_STOCK or LOW_STOCK
  // product. Until then, we suppress the "Out of Stock" badge because the
  // InventoryItem feed may not be populated yet — showing 3K red badges on a
  // new catalog made it look broken.
  const [inventoryFeedActive, setInventoryFeedActive] = useState(false)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const categories = PRODUCT_TAXONOMY.map(c => c.name)

  /* ── fetch ── */
  const fetchProducts = useCallback(
    async (q: string, cat: string, pg: number) => {
      setLoading(true)
      try {
        const p = new URLSearchParams()
        if (q) p.set('search', q)
        if (cat && cat !== 'All') p.set('category', cat)
        p.set('page', String(pg))
        p.set('limit', '40')
        const res = await fetch('/api/catalog?' + p.toString())
        if (res.ok) {
          const d = await res.json()
          const items: Product[] = d.products || []
          setProducts(items)
          setTotal(d.total || 0)
          setTotalPages(d.totalPages || 1)
          setHasPricing(!!d.hasPricing)
          // Treat feed as active as soon as we see any non-zero stock on ANY
          // page — latched on so it stays stable if a later page is all zeros.
          if (items.some(it => it.stockStatus !== 'OUT_OF_STOCK')) {
            setInventoryFeedActive(true)
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Catalog fetch error:', err)
        }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchProducts('', 'All', 1)
  }, [fetchProducts])

  /* ── handlers ── */
  const onSearch = (val: string) => {
    setSearch(val)
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => {
      setPage(1)
      fetchProducts(val, categoryFilter, 1)
    }, 350)
    setTimer(t)
  }

  const onCategory = (cat: string) => {
    setCategoryFilter(cat)
    setPage(1)
    fetchProducts(search, cat, 1)
  }

  const onPage = (pg: number) => {
    setPage(pg)
    fetchProducts(search, categoryFilter, pg)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* ── styles ── */
  const S = {
    page: { display: 'flex', minHeight: '100vh', backgroundColor: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
    sidebar: { width: 240, backgroundColor: '#fff', borderRight: '1px solid #e5e7eb', padding: '24px 0', flexShrink: 0, position: 'sticky' as const, top: 0, height: '100vh', overflowY: 'auto' as const } as React.CSSProperties,
    main: { flex: 1, padding: '24px 32px' } as React.CSSProperties,
    catBtn: (active: boolean) => ({
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 20px',
      border: 'none', cursor: 'pointer', fontSize: 14, textAlign: 'left' as const,
      backgroundColor: active ? '#EBF5FB' : 'transparent',
      color: active ? '#0f2a3e' : '#374151',
      fontWeight: active ? 600 : 400,
      borderLeft: active ? '3px solid #0f2a3e' : '3px solid transparent',
    }),
    searchWrap: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' } as React.CSSProperties,
    searchInput: { flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' } as React.CSSProperties,
    viewBtn: (active: boolean) => ({
      padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
      backgroundColor: active ? '#0f2a3e' : '#fff', color: active ? '#fff' : '#374151', fontSize: 13,
    }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 } as React.CSSProperties,
    card: { backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.2s' } as React.CSSProperties,
    imgBox: { width: '100%', height: 180, backgroundColor: '#f5f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } as React.CSSProperties,
    cardBody: { padding: 16 } as React.CSSProperties,
    badge: (color: string) => ({
      display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      backgroundColor: color + '15', color,
    }),
    listRow: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 8, cursor: 'pointer' } as React.CSSProperties,
    listImg: { width: 56, height: 56, backgroundColor: '#f5f6fa', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' } as React.CSSProperties,
    pager: { display: 'flex', justifyContent: 'center', gap: 6, marginTop: 32 } as React.CSSProperties,
    pageBtn: (active: boolean) => ({
      padding: '8px 14px', borderRadius: 6, border: active ? '2px solid #0f2a3e' : '1px solid #d1d5db',
      backgroundColor: active ? '#0f2a3e' : '#fff', color: active ? '#fff' : '#374151',
      cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 400,
    }),
    modal: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 } as React.CSSProperties,
    modalBox: { backgroundColor: '#fff', borderRadius: 12, padding: 32, maxWidth: 560, width: '90%', maxHeight: '85vh', overflowY: 'auto' as const, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' } as React.CSSProperties,
  }

  /* ── pagination helper ── */
  const pageButtons = () => {
    const btns: number[] = []
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, page + 2)
    for (let i = start; i <= end; i++) btns.push(i)
    return btns
  }

  /* ── render product card ── */
  const renderCard = (p: Product) => {
    const price = p.builderPrice || p.basePrice
    const color = catColor(p.cleanCategory)
    // Only show stock badges when the inventory feed has real signal.
    // When the entire batch reports 0 stock, treat as "inventory feed
    // not wired" rather than blanketing every card with a red "Out of Stock"
    // badge — which was making the whole catalog look broken.
    const showStockBadge = inventoryFeedActive && p.stockStatus !== 'OUT_OF_STOCK'
    const stockBadgeColor = p.stockStatus === 'IN_STOCK' ? '#27ae60' : '#C6A24E'
    const stockBadgeLabel = p.stockStatus === 'IN_STOCK' ? 'In Stock' : `Low Stock (${p.stock} left)`

    return (
      <div key={p.id} style={S.card}
        onClick={() => setSelectedProduct(p)}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
      >
        <div style={S.imgBox}>
          {p.imageUrl ? (
            <Image src={p.thumbnailUrl || p.imageUrl} alt={p.displayName || p.name}
              width={260} height={180}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <Placeholder cat={p.cleanCategory} />
          )}
        </div>
        <div style={S.cardBody}>
          <span style={S.badge(color)}>{p.cleanCategory}</span>
          {showStockBadge && (
            <span style={{ ...S.badge(stockBadgeColor), marginLeft: 8 }}>{stockBadgeLabel}</span>
          )}
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0 4px', color: '#1f2937', lineHeight: 1.3 }}>
            {p.displayName || p.name}
          </h3>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>{p.sku}</p>
          {price > 0 ? (
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f2a3e' }}>{fmtPrice(price)}</div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#C6A24E' }}>Request Quote</div>
          )}
          {hasPricing && p.priceSource === 'CUSTOM' && (
            <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 600 }}>★ Custom Price</span>
          )}
          {hasPricing && p.priceSource === 'TIER' && (
            <span style={{ fontSize: 11, color: '#2980b9', fontWeight: 600 }}>Tier Pricing</span>
          )}
        </div>
      </div>
    )
  }

  /* ── render list row ── */
  const renderListRow = (p: Product) => {
    const price = p.builderPrice || p.basePrice
    const showStockBadge = inventoryFeedActive && p.stockStatus !== 'OUT_OF_STOCK'
    const stockBadgeColor = p.stockStatus === 'IN_STOCK' ? '#27ae60' : '#C6A24E'
    const stockBadgeLabel = p.stockStatus === 'IN_STOCK' ? 'In Stock' : `Low Stock (${p.stock} left)`

    return (
      <div key={p.id} style={S.listRow} onClick={() => setSelectedProduct(p)}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f9fafb' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#fff' }}
      >
        <div style={S.listImg}>
          {p.imageUrl ? (
            <Image src={p.thumbnailUrl || p.imageUrl} alt={p.displayName || p.name}
              width={56} height={56}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <Placeholder cat={p.cleanCategory} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{p.displayName || p.name}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{p.sku} · {p.cleanCategory}</div>
          {showStockBadge && (
            <span style={{ ...S.badge(stockBadgeColor), fontSize: 10 }}>{stockBadgeLabel}</span>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {price > 0 ? (
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f2a3e' }}>{fmtPrice(price)}</div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#C6A24E' }}>Request Quote</div>
          )}
        </div>
      </div>
    )
  }

  /* ── product detail modal ── */
  const renderModal = () => {
    if (!selectedProduct) return null
    const p = selectedProduct
    const price = p.builderPrice || p.basePrice
    // Only treat as out-of-stock when the inventory feed is actually active.
    const isOutOfStock = inventoryFeedActive && p.stockStatus === 'OUT_OF_STOCK'
    const showStockBadge = inventoryFeedActive
    const stockBadgeColor = p.stockStatus === 'IN_STOCK' ? '#27ae60' : p.stockStatus === 'LOW_STOCK' ? '#C6A24E' : '#e74c3c'
    const stockBadgeLabel = p.stockStatus === 'IN_STOCK' ? 'In Stock' : p.stockStatus === 'LOW_STOCK' ? `Low Stock (${p.stock} left)` : 'Out of Stock'
    const specs = [
      p.doorSize && ['Size', p.doorSize],
      p.handing && ['Handing', p.handing],
      p.coreType && ['Core', p.coreType],
      p.panelStyle && ['Panel', p.panelStyle],
      p.jambSize && ['Jamb', p.jambSize],
      p.material && ['Material', p.material],
      p.fireRating && ['Fire Rating', p.fireRating],
      p.hardwareFinish && ['Finish', p.hardwareFinish],
    ].filter(Boolean) as [string, string][]

    return (
      <div style={S.modal} onClick={() => setSelectedProduct(null)}>
        <div style={S.modalBox} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f2a3e' }}>Product Details</h2>
            <button onClick={() => setSelectedProduct(null)}
              style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ ...S.imgBox, height: 240, borderRadius: 8, marginBottom: 20 }}>
            {p.imageUrl ? (
              <Image src={p.imageUrl} alt={p.displayName || p.name}
                width={560} height={240}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <Placeholder cat={p.cleanCategory} />
            )}
          </div>

          <span style={S.badge(catColor(p.cleanCategory))}>{p.cleanCategory}</span>
          {showStockBadge && (
            <span style={{ ...S.badge(stockBadgeColor), marginLeft: 8 }}>{stockBadgeLabel}</span>
          )}
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', margin: '10px 0 4px' }}>{p.displayName || p.name}</h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 4px' }}>SKU: {p.sku}</p>
          {p.description && <p style={{ fontSize: 13, color: '#4b5563', margin: '8px 0 16px', lineHeight: 1.5 }}>{p.description}</p>}

          {price > 0 ? (
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', margin: '12px 0' }}>{fmtPrice(price)}</div>
          ) : (
            <div style={{ fontSize: 16, fontWeight: 600, color: '#C6A24E', margin: '12px 0' }}>Contact us for pricing</div>
          )}

          {specs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Specifications</h4>
              {specs.map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                  <span style={{ color: '#6b7280' }}>{label}</span>
                  <span style={{ color: '#1f2937', fontWeight: 500 }}>{val}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button
              disabled={isOutOfStock}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 8,
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                backgroundColor: isOutOfStock ? '#d1d5db' : '#0f2a3e',
                color: isOutOfStock ? '#9ca3af' : '#fff',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isOutOfStock) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#153d56'
                }
              }}
              onMouseLeave={(e) => {
                if (!isOutOfStock) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#0f2a3e'
                }
              }}
            >
              {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </button>
            <a
              href={`/catalog/${p.id}`}
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                border: '2px solid #0f2a3e',
                fontSize: 14,
                fontWeight: 600,
                color: '#0f2a3e',
                textDecoration: 'none',
                textAlign: 'center',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              Full Details →
            </a>
          </div>
        </div>
      </div>
    )
  }

  /* ═══════════ JSX ═══════════ */
  return (
    <div style={S.page}>
      {/* Sidebar */}
      <aside style={S.sidebar}>
        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#9ca3af', padding: '0 20px', marginBottom: 12 }}>Categories</h3>
        <button style={S.catBtn(categoryFilter === 'All')} onClick={() => onCategory('All')}>📦 All Products</button>
        {categories.map(cat => (
          <button key={cat} style={S.catBtn(categoryFilter === cat)} onClick={() => onCategory(cat)}>
            {catIcon(cat)} {cat}
          </button>
        ))}
      </aside>

      {/* Main */}
      <main style={S.main}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f2a3e', margin: 0 }}>Product Catalog</h1>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {loading ? 'Loading...' : `${total.toLocaleString()} products`}
          </span>
        </div>

        {/* Product Bundles Section */}
        <ProductBundles />

        {/* Search + View Toggle */}
        <div style={S.searchWrap}>
          <input
            type="text"
            placeholder="Search by product name or SKU..."
            value={search}
            onChange={e => onSearch(e.target.value)}
            style={S.searchInput}
          />
          <button style={S.viewBtn(viewMode === 'grid')} onClick={() => setViewMode('grid')}>⊞ Grid</button>
          <button style={S.viewBtn(viewMode === 'list')} onClick={() => setViewMode('list')}>≡ List</button>
        </div>

        {/* Products */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 15 }}>Loading products...</div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>No products found</p>
            <p style={{ fontSize: 14 }}>Try adjusting your search or category filter</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div style={S.grid}>{products.map(renderCard)}</div>
        ) : (
          <div>{products.map(renderListRow)}</div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div style={S.pager}>
            {page > 1 && <button style={S.pageBtn(false)} onClick={() => onPage(1)}>« First</button>}
            {page > 1 && <button style={S.pageBtn(false)} onClick={() => onPage(page - 1)}>‹ Prev</button>}
            {pageButtons().map(n => (
              <button key={n} style={S.pageBtn(n === page)} onClick={() => onPage(n)}>{n}</button>
            ))}
            {page < totalPages && <button style={S.pageBtn(false)} onClick={() => onPage(page + 1)}>Next ›</button>}
            {page < totalPages && <button style={S.pageBtn(false)} onClick={() => onPage(totalPages)}>Last »</button>}
          </div>
        )}
      </main>

      {/* Modal */}
      {renderModal()}
    </div>
  )
}
