'use client'
// Product Catalog v2 — renamed from Product Image Management
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getProductImageUrl, isUsingPlaceholder } from '@/lib/product-images'
import './products.css'

interface Product {
  id: string
  sku: string
  name: string
  displayName?: string | null
  category: string
  subcategory?: string | null
  basePrice: number
  imageUrl?: string | null
  thumbnailUrl?: string | null
  imageAlt?: string | null
  inStock: boolean
  hasImage?: boolean
}

interface PaginationInfo {
  skip: number
  take: number
  total: number
}

interface Stats {
  total: number
  withImages: number
  needingImages: number
  byCategory: Record<string, { total: number; withImages: number; needingImages: number }>
}

interface FetchResponse {
  products: Product[]
  pagination: PaginationInfo
  stats: Stats
}

interface CategoryInfo {
  current: string
  productCount: number
  mappedTo: string | null
  willChange: boolean
}

export default function ProductsCatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [priceFilter, setPriceFilter] = useState<'all' | 'priced' | 'unpriced'>('all')
  const [skip, setSkip] = useState(0)
  const [take] = useState(50)

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [modalImageUrl, setModalImageUrl] = useState('')
  const [modalThumbnailUrl, setModalThumbnailUrl] = useState('')
  const [modalImageAlt, setModalImageAlt] = useState('')
  const [savingModal, setSavingModal] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  // Category cleanup state
  const [showCatCleanup, setShowCatCleanup] = useState(false)
  const [catData, setCatData] = useState<{ currentCategoryCount: number; afterCleanupCount: number; categories: CategoryInfo[] } | null>(null)
  const [catLoading, setCatLoading] = useState(false)
  const [catNormalizing, setCatNormalizing] = useState(false)

  async function loadCategoryPreview() {
    setCatLoading(true)
    try {
      const res = await fetch('/api/ops/products/categories')
      const data = await res.json()
      setCatData(data)
    } catch {
      showToastMsg('Failed to load categories', 'error')
    } finally {
      setCatLoading(false)
    }
  }

  async function runCategoryNormalization() {
    setCatNormalizing(true)
    try {
      const res = await fetch('/api/ops/products/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'NORMALIZE' }),
      })
      const data = await res.json()
      if (data.success) {
        showToastMsg(`Cleaned up categories: ${data.categoriesBefore} → ${data.categoriesAfter} (${data.productsUpdated} products updated)`)
        setShowCatCleanup(false)
        setCatData(null)
        // Refresh products to show new categories
        fetchProducts()
      } else {
        showToastMsg(data.error || 'Failed to normalize', 'error')
      }
    } catch {
      showToastMsg('Failed to normalize categories', 'error')
    } finally {
      setCatNormalizing(false)
    }
  }

  function showToastMsg(msg: string, type: 'success' | 'error' = 'success') {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  // Fetch products
  const fetchProducts = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.append('skip', skip.toString())
      params.append('take', take.toString())

      if (categoryFilter) {
        params.append('category', categoryFilter)
      }
      if (searchQuery) {
        params.append('search', searchQuery)
      }
      if (priceFilter === 'priced') {
        params.append('priceStatus', 'priced')
      } else if (priceFilter === 'unpriced') {
        params.append('priceStatus', 'unpriced')
      }

      const response = await fetch(`/api/ops/products?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch products')
      }

      const data: FetchResponse = await response.json()
      setProducts(data.products)
      setStats(data.stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSkip(0)
  }, [categoryFilter, searchQuery, priceFilter])

  useEffect(() => {
    fetchProducts()
  }, [skip, take, categoryFilter, searchQuery, priceFilter])

  const handleOpenModal = (product: Product) => {
    setSelectedProduct(product)
    setModalImageUrl(product.imageUrl || '')
    setModalThumbnailUrl(product.thumbnailUrl || '')
    setModalImageAlt(product.imageAlt || '')
  }

  const handleSaveImage = async () => {
    if (!selectedProduct || !modalImageUrl.trim()) {
      showToast('Please enter an image URL', 'error')
      return
    }

    try {
      setSavingModal(true)
      const response = await fetch('/api/ops/products/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [
            {
              productId: selectedProduct.id,
              imageUrl: modalImageUrl.trim(),
              thumbnailUrl: modalThumbnailUrl.trim() || null,
              imageAlt: modalImageAlt.trim() || null,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save image')
      }

      // Refresh products list
      await fetchProducts()
      setSelectedProduct(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save image', 'error')
    } finally {
      setSavingModal(false)
    }
  }

  return (
    <div className="products-page">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#3E2A1E]'
        }`}>
          {toast}
        </div>
      )}
      {/* Header */}
      <div className="products-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Product Catalog</h1>
          <p>Browse, search, and manage your complete product catalog</p>
        </div>
        <button
          onClick={() => { setShowCatCleanup(true); loadCategoryPreview() }}
          style={{
            padding: '10px 20px',
            backgroundColor: '#C9822B',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Clean Up Categories
        </button>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{stats.total.toLocaleString()}</div>
            <div className="stat-label">Total Products</div>
          </div>
          <div className="stat-card success">
            <div className="stat-value">{stats.withImages.toLocaleString()}</div>
            <div className="stat-label">With Images</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{((stats.withImages / stats.total) * 100).toFixed(0)}%</div>
            <div className="stat-label">Image Coverage</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Object.keys(stats.byCategory).length}</div>
            <div className="stat-label">Categories</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="controls-section">
        <div className="control-group">
          <label htmlFor="search">Search by Name or SKU</label>
          <input
            id="search"
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-text"
          />
        </div>

        <div className="control-group">
          <label htmlFor="category">Filter by Category</label>
          <select
            id="category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input-select"
          >
            <option value="">All Categories</option>
            {stats && Object.entries(stats.byCategory)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([cat, info]) => (
              <option key={cat} value={cat}>
                {cat} ({info.total})
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="priceStatus">Price Status</label>
          <select
            id="priceStatus"
            value={priceFilter}
            onChange={(e) => setPriceFilter(e.target.value as any)}
            className="input-select"
          >
            <option value="all">All</option>
            <option value="priced">Priced</option>
            <option value="unpriced">Needs Pricing ($0)</option>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="view">View Mode</label>
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="products-content">
        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <p>No products found. Try adjusting your filters.</p>
          </div>
        ) : (
          <>
            {viewMode === 'grid' ? (
              <div className="products-grid">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className={`product-card ${!product.imageUrl ? 'no-image' : ''}`}
                    onClick={() => handleOpenModal(product)}
                  >
                    <div className="product-image-container">
                      <Image
                        src={getProductImageUrl({
                          imageUrl: product.imageUrl,
                          category: product.category,
                          subcategory: product.subcategory,
                        })}
                        alt={product.imageAlt || product.name}
                        width={300}
                        height={300}
                        className="product-image"
                      />
                      <div className={`image-status ${product.imageUrl ? 'has-image' : 'needs-image'}`}>
                        <span className="status-dot"></span>
                        {product.imageUrl ? 'Image' : 'Placeholder'}
                      </div>
                    </div>
                    <div className="product-info">
                      <div className="product-sku">{product.sku}</div>
                      <h3 className="product-name">{product.displayName || product.name}</h3>
                      <div className="product-meta">
                        <span className="category-badge">{product.category}</span>
                        {product.subcategory && <span className="subcategory-badge">{product.subcategory}</span>}
                      </div>
                      <div className={`product-price ${product.basePrice === 0 ? 'needs-pricing' : ''}`}>
                        {product.basePrice > 0 ? `$${product.basePrice.toFixed(2)}` : 'Needs Pricing'}
                      </div>
                      <div className={`stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}`}>
                        {product.inStock ? 'In Stock' : 'Out of Stock'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="products-list">
                <table className="products-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>SKU</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <Image
                            src={getProductImageUrl({
                              imageUrl: product.imageUrl,
                              category: product.category,
                              subcategory: product.subcategory,
                            })}
                            alt={product.imageAlt || product.name}
                            width={80}
                            height={80}
                            className="list-image"
                          />
                        </td>
                        <td>{product.sku}</td>
                        <td>{product.displayName || product.name}</td>
                        <td>{product.category}</td>
                        <td className={product.basePrice === 0 ? 'needs-pricing' : ''}>
                          {product.basePrice > 0 ? `$${product.basePrice.toFixed(2)}` : 'Needs Pricing'}
                        </td>
                        <td>
                          <span className={`image-badge ${product.imageUrl ? 'has' : 'needs'}`}>
                            {product.imageUrl ? 'Has Image' : 'Placeholder'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="action-btn"
                            onClick={() => handleOpenModal(product)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div className="pagination">
              <button
                disabled={skip === 0}
                onClick={() => setSkip(Math.max(0, skip - take))}
                className="pagination-btn"
              >
                Previous
              </button>
              <span className="pagination-info">
                Showing {skip + 1} - {Math.min(skip + take, stats?.total || 0)} of {stats?.total || 0}
              </span>
              <button
                disabled={skip + take >= (stats?.total || 0)}
                onClick={() => setSkip(skip + take)}
                className="pagination-btn"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Product Image</h2>
              <button
                className="modal-close"
                onClick={() => setSelectedProduct(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Current Image Preview */}
              <div className="modal-section">
                <h3>Current Image</h3>
                <div className="preview-container">
                  <Image
                    src={getProductImageUrl({
                      imageUrl: modalImageUrl || selectedProduct.imageUrl,
                      category: selectedProduct.category,
                      subcategory: selectedProduct.subcategory,
                    })}
                    alt={selectedProduct.name}
                    width={400}
                    height={400}
                    className="preview-image"
                  />
                  <div className="preview-info">
                    <p>
                      <strong>SKU:</strong> {selectedProduct.sku}
                    </p>
                    <p>
                      <strong>Name:</strong> {selectedProduct.name}
                    </p>
                    <p>
                      <strong>Category:</strong> {selectedProduct.category}
                    </p>
                    {selectedProduct.subcategory && (
                      <p>
                        <strong>Subcategory:</strong> {selectedProduct.subcategory}
                      </p>
                    )}
                    <p>
                      <strong>Price:</strong> ${selectedProduct.basePrice.toFixed(2)}
                    </p>
                    <p className={`status-line ${selectedProduct.imageUrl ? 'has-image' : 'no-image'}`}>
                      <strong>Status:</strong>{' '}
                      {selectedProduct.imageUrl ? 'Using custom image' : 'Using placeholder'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Image URL Input */}
              <div className="modal-section">
                <label htmlFor="imageUrl">Primary Image URL</label>
                <input
                  id="imageUrl"
                  type="text"
                  placeholder="https://example.com/image.jpg"
                  value={modalImageUrl}
                  onChange={(e) => setModalImageUrl(e.target.value)}
                  className="input-text full-width"
                />
                <small>Enter the full URL to the product image</small>
              </div>

              {/* Thumbnail URL Input */}
              <div className="modal-section">
                <label htmlFor="thumbnailUrl">Thumbnail URL (Optional)</label>
                <input
                  id="thumbnailUrl"
                  type="text"
                  placeholder="https://example.com/thumbnail.jpg"
                  value={modalThumbnailUrl}
                  onChange={(e) => setModalThumbnailUrl(e.target.value)}
                  className="input-text full-width"
                />
                <small>Smaller version for lists and grids</small>
              </div>

              {/* Alt Text Input */}
              <div className="modal-section">
                <label htmlFor="imageAlt">Alt Text (Optional)</label>
                <input
                  id="imageAlt"
                  type="text"
                  placeholder="Description of the image"
                  value={modalImageAlt}
                  onChange={(e) => setModalImageAlt(e.target.value)}
                  className="input-text full-width"
                />
                <small>Accessibility description for the image</small>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setSelectedProduct(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveImage}
                disabled={savingModal || !modalImageUrl.trim()}
              >
                {savingModal ? 'Saving...' : 'Save Image'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Cleanup Modal */}
      {showCatCleanup && (
        <div className="modal-overlay" onClick={() => setShowCatCleanup(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '720px', maxHeight: '85vh', overflow: 'auto' }}>
            <div className="modal-header">
              <h2>Clean Up Categories</h2>
              <button className="modal-close" onClick={() => setShowCatCleanup(false)}>✕</button>
            </div>
            <div className="modal-body">
              {catLoading ? (
                <div style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{ width: '24px', height: '24px', border: '3px solid #3E2A1E', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
                  <p style={{ marginTop: '12px', color: '#6b7280', fontSize: '14px' }}>Loading category analysis...</p>
                </div>
              ) : catData && catData.categories ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#dc2626' }}>{catData.currentCategoryCount}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Current Categories</div>
                    </div>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#16a34a' }}>{catData.afterCleanupCount}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>After Cleanup</div>
                    </div>
                  </div>

                  <p style={{ fontSize: '13px', color: '#374151', marginBottom: '16px' }}>
                    This will consolidate {catData.currentCategoryCount} messy categories down to ~{catData.afterCleanupCount} clean, standardized categories. Categories that don&apos;t match any mapping will stay unchanged.
                  </p>

                  <div style={{ maxHeight: '350px', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Current Category</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Products</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Maps To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catData.categories.map((cat, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 12px', color: cat.willChange ? '#9ca3af' : '#111827', textDecoration: cat.willChange ? 'line-through' : 'none' }}>
                              {cat.current}
                            </td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', color: '#6b7280' }}>{cat.productCount}</td>
                            <td style={{ padding: '6px 12px' }}>
                              {cat.willChange ? (
                                <span style={{ color: '#16a34a', fontWeight: 600 }}>{cat.mappedTo}</span>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCatCleanup(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={runCategoryNormalization}
                disabled={catNormalizing || catLoading || !catData}
                style={{ background: '#C9822B' }}
              >
                {catNormalizing ? 'Cleaning Up...' : `Normalize ${catData?.categories?.filter(c => c.willChange).length || 0} Categories`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
