'use client'

/**
 * Customer Catalog (Ops view) — A-UX-6
 *
 * Staff-facing view of "what a specific builder sees" in the catalog.
 * Pick a builder; their custom prices (BuilderPricing) overlay base prices.
 * Filter by category, search, in-stock toggle. Sort + paginate (50/page server-side).
 * "Add to Quote" stages items in localStorage for the active builder; the user
 * can then push the staged cart to the Quote Builder. (No new DB tables — the
 * full-blown quote-creation flow lives at /ops/quotes/new and requires a takeoff.)
 *
 * Endpoints used:
 *   GET /api/ops/builders                 — populate the builder dropdown
 *   GET /api/ops/customer-catalog         — products + builder pricing + stock
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Search,
  Package,
  Plus,
  ShoppingCart,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { formatCurrency, cn } from '@/lib/utils'

// ── Types ───────────────────────────────────────────────────────────────────

interface Builder {
  id: string
  companyName: string
  contactName: string
  status: string
}

interface CatalogProduct {
  id: string
  sku: string
  name: string
  displayName?: string | null
  category: string
  subcategory?: string | null
  basePrice: number
  builderPrice: number | null
  effectivePrice: number
  priceSource: 'builder' | 'list'
  imageUrl?: string | null
  thumbnailUrl?: string | null
  imageAlt?: string | null
  available: number
  inStock: boolean
  createdAt: string
}

interface PageMeta {
  page: number
  pageSize: number
  total: number
  pages: number
}

interface CatalogResponse {
  products: CatalogProduct[]
  pagination: PageMeta
  categories: string[]
}

interface CartLine {
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
}

type SortKey = 'name' | 'priceAsc' | 'priceDesc' | 'newest'

// ── Helpers ─────────────────────────────────────────────────────────────────

const CART_KEY_PREFIX = 'abel.ops.customerCatalog.cart.'
const SELECTED_BUILDER_KEY = 'abel.ops.customerCatalog.selectedBuilder'

function readCart(builderId: string): CartLine[] {
  if (typeof window === 'undefined' || !builderId) return []
  try {
    const raw = localStorage.getItem(CART_KEY_PREFIX + builderId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCart(builderId: string, lines: CartLine[]) {
  if (typeof window === 'undefined' || !builderId) return
  try {
    localStorage.setItem(CART_KEY_PREFIX + builderId, JSON.stringify(lines))
  } catch {
    /* quota / private mode — ignore */
  }
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CustomerCatalogPage() {
  // Builder selection
  const [builders, setBuilders] = useState<Builder[]>([])
  const [buildersLoading, setBuildersLoading] = useState(true)
  const [buildersError, setBuildersError] = useState<string | null>(null)
  const [builderId, setBuilderId] = useState<string>('')

  // Catalog state
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [meta, setMeta] = useState<PageMeta>({
    page: 1,
    pageSize: 50,
    total: 0,
    pages: 1,
  })
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters / sort / pagination
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [page, setPage] = useState(1)

  // Cart (per builder, localStorage)
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [toast, setToast] = useState<string>('')

  // ── Load builders once ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setBuildersLoading(true)
        setBuildersError(null)
        const res = await fetch('/api/ops/builders?limit=200&status=ACTIVE')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        const list: Builder[] = (data.builders || []).map((b: any) => ({
          id: b.id,
          companyName: b.companyName,
          contactName: b.contactName,
          status: b.status,
        }))
        list.sort((a, b) => a.companyName.localeCompare(b.companyName))
        setBuilders(list)
        // Restore last selection
        try {
          const last = localStorage.getItem(SELECTED_BUILDER_KEY) || ''
          if (last && list.some((b) => b.id === last)) setBuilderId(last)
        } catch {
          /* ignore */
        }
      } catch (e: any) {
        if (!cancelled) setBuildersError(e?.message || 'Failed to load builders')
      } finally {
        if (!cancelled) setBuildersLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist builder selection + load cart
  useEffect(() => {
    if (!builderId) {
      setCart([])
      return
    }
    try {
      localStorage.setItem(SELECTED_BUILDER_KEY, builderId)
    } catch {
      /* ignore */
    }
    setCart(readCart(builderId))
  }, [builderId])

  // ── Debounce search ─────────────────────────────────────────────────────

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, category, inStockOnly, sort, builderId])

  // ── Fetch catalog page ──────────────────────────────────────────────────

  const fetchCatalog = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (builderId) params.set('builderId', builderId)
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (category) params.set('category', category)
      if (inStockOnly) params.set('inStockOnly', '1')
      params.set('sort', sort)
      params.set('page', String(page))
      params.set('pageSize', '50')
      const res = await fetch(`/api/ops/customer-catalog?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: CatalogResponse = await res.json()
      setProducts(data.products || [])
      setMeta(data.pagination)
      // Categories list is filter-independent; only set once we have it
      if (data.categories?.length) setCategories(data.categories)
    } catch (e: any) {
      setError(e?.message || 'Failed to load catalog')
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [builderId, debouncedSearch, category, inStockOnly, sort, page])

  useEffect(() => {
    fetchCatalog()
  }, [fetchCatalog])

  // ── Cart actions ────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  function addToCart(p: CatalogProduct) {
    if (!builderId) return
    const existing = cart.find((l) => l.productId === p.id)
    let next: CartLine[]
    if (existing) {
      next = cart.map((l) =>
        l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l
      )
    } else {
      next = [
        ...cart,
        {
          productId: p.id,
          sku: p.sku,
          name: p.displayName || p.name,
          quantity: 1,
          unitPrice: p.effectivePrice,
        },
      ]
    }
    setCart(next)
    writeCart(builderId, next)
    showToast(`Added ${p.sku} to staged quote`)
  }

  function removeFromCart(productId: string) {
    if (!builderId) return
    const next = cart.filter((l) => l.productId !== productId)
    setCart(next)
    writeCart(builderId, next)
  }

  function updateQty(productId: string, qty: number) {
    if (!builderId) return
    const next = cart
      .map((l) =>
        l.productId === productId
          ? { ...l, quantity: Math.max(1, Math.floor(qty) || 1) }
          : l
      )
      .filter((l) => l.quantity > 0)
    setCart(next)
    writeCart(builderId, next)
  }

  function clearCart() {
    if (!builderId) return
    setCart([])
    writeCart(builderId, [])
  }

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [cart]
  )
  const cartCount = useMemo(
    () => cart.reduce((s, l) => s + l.quantity, 0),
    [cart]
  )

  const selectedBuilder = builders.find((b) => b.id === builderId)

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        eyebrow="Growth Engine"
        title="Customer Catalog"
        description="Builder-facing product catalog. Pick a builder to see their custom pricing and stage items for a quote."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Growth', href: '/ops/growth/leads' },
          { label: 'Customer Catalog' },
        ]}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCartOpen(true)}
            disabled={!builderId || cart.length === 0}
            icon={<ShoppingCart className="w-4 h-4" />}
          >
            Staged Quote
            {cartCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-signal text-[10px] font-bold text-fg-on-accent">
                {cartCount}
              </span>
            )}
          </Button>
        }
      />

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <Card padding="sm" className="mb-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Builder selector */}
          <div className="md:col-span-4">
            <label className="block text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.12em] mb-1.5">
              Builder
            </label>
            <select
              value={builderId}
              onChange={(e) => setBuilderId(e.target.value)}
              disabled={buildersLoading}
              className="w-full h-9 px-3 text-sm bg-surface-muted border border-border rounded-md text-fg focus:outline-none focus:ring-2 focus:ring-signal/40"
            >
              <option value="">— No builder (list pricing) —</option>
              {builders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.companyName}
                  {b.contactName ? ` (${b.contactName})` : ''}
                </option>
              ))}
            </select>
            {buildersError && (
              <p className="mt-1 text-[11px] text-data-negative-fg">
                {buildersError}
              </p>
            )}
          </div>

          {/* Search */}
          <div className="md:col-span-3">
            <label className="block text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.12em] mb-1.5">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SKU, name, description…"
                className="w-full h-9 pl-8 pr-3 text-sm bg-surface-muted border border-border rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-signal/40"
              />
            </div>
          </div>

          {/* Category */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.12em] mb-1.5">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-surface-muted border border-border rounded-md text-fg focus:outline-none focus:ring-2 focus:ring-signal/40"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.12em] mb-1.5">
              Sort
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="w-full h-9 px-3 text-sm bg-surface-muted border border-border rounded-md text-fg focus:outline-none focus:ring-2 focus:ring-signal/40"
            >
              <option value="name">Name (A→Z)</option>
              <option value="priceAsc">Price (low → high)</option>
              <option value="priceDesc">Price (high → low)</option>
              <option value="newest">Newest first</option>
            </select>
          </div>

          {/* In-stock toggle */}
          <div className="md:col-span-1">
            <label className="block text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.12em] mb-1.5">
              Stock
            </label>
            <label className="inline-flex items-center gap-2 h-9 px-3 bg-surface-muted border border-border rounded-md cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="w-3.5 h-3.5 accent-signal"
              />
              <span className="text-xs text-fg">In stock</span>
            </label>
          </div>
        </div>

        {/* Selected-builder banner */}
        {selectedBuilder && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
            <div className="text-fg-muted">
              Showing pricing for{' '}
              <span className="text-fg font-semibold">
                {selectedBuilder.companyName}
              </span>
              . Highlighted prices come from{' '}
              <span className="text-signal font-semibold">BuilderPricing</span>{' '}
              overrides.
            </div>
            <button
              onClick={() => setBuilderId('')}
              className="text-fg-subtle hover:text-fg transition-colors inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> clear
            </button>
          </div>
        )}
      </Card>

      {/* ── Result summary ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-fg-muted">
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading…
            </span>
          ) : error ? (
            <span className="inline-flex items-center gap-1.5 text-data-negative-fg">
              <AlertCircle className="w-3 h-3" />
              {error}
            </span>
          ) : (
            <>
              <span className="text-fg font-semibold tabular-nums">
                {meta.total.toLocaleString()}
              </span>{' '}
              product{meta.total === 1 ? '' : 's'}
              {meta.pages > 1 && (
                <>
                  {' '}
                  · page <span className="tabular-nums">{meta.page}</span> of{' '}
                  <span className="tabular-nums">{meta.pages}</span>
                </>
              )}
            </>
          )}
        </div>
        {meta.pages > 1 && !loading && !error && (
          <Pagination meta={meta} onPage={setPage} />
        )}
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <Card padding="lg">
          <EmptyState
            icon="package"
            title="Couldn't load catalog"
            description={error}
            action={{ label: 'Retry', onClick: () => fetchCatalog() }}
          />
        </Card>
      ) : products.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon="package"
            title="No products match"
            description={
              debouncedSearch || category || inStockOnly
                ? 'Try clearing filters or widening your search.'
                : 'There are no active products in the catalog yet.'
            }
            secondaryAction={
              debouncedSearch || category || inStockOnly
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setSearch('')
                      setCategory('')
                      setInStockOnly(false)
                    },
                  }
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              showAddButton={!!builderId}
              onAdd={addToCart}
            />
          ))}
        </div>
      )}

      {/* ── Pagination footer ─────────────────────────────────────────── */}
      {meta.pages > 1 && !loading && !error && (
        <div className="mt-6 flex justify-center">
          <Pagination meta={meta} onPage={setPage} />
        </div>
      )}

      {/* ── Cart drawer ───────────────────────────────────────────────── */}
      {cartOpen && (
        <CartDrawer
          builderName={selectedBuilder?.companyName || ''}
          lines={cart}
          total={cartTotal}
          onClose={() => setCartOpen(false)}
          onRemove={removeFromCart}
          onQty={updateQty}
          onClear={clearCart}
        />
      )}

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg bg-fg text-canvas text-sm font-medium shadow-lg animate-[fadeIn_120ms_ease-out]">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Product Card ────────────────────────────────────────────────────────────

function ProductCard({
  product,
  showAddButton,
  onAdd,
}: {
  product: CatalogProduct
  showAddButton: boolean
  onAdd: (p: CatalogProduct) => void
}) {
  const name = product.displayName || product.name
  const img = product.thumbnailUrl || product.imageUrl
  const isCustomPrice = product.priceSource === 'builder'
  const detailHref = `/ops/products?search=${encodeURIComponent(product.sku)}`

  return (
    <Card
      variant="interactive"
      padding="none"
      className="group overflow-hidden flex flex-col"
    >
      <Link href={detailHref} className="block focus:outline-none">
        <div className="aspect-[4/3] bg-surface-muted relative overflow-hidden">
          {img ? (
            <Image
              src={img}
              alt={product.imageAlt || name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-fg-subtle">
              <Package className="w-10 h-10" />
            </div>
          )}
          {/* Stock pill */}
          <div className="absolute top-2 right-2">
            {product.inStock ? (
              <Badge variant="success" size="xs" dot>
                {product.available > 99 ? '99+' : product.available} in stock
              </Badge>
            ) : (
              <Badge variant="neutral" size="xs">
                Out
              </Badge>
            )}
          </div>
          {/* Custom-price ribbon */}
          {isCustomPrice && (
            <div className="absolute top-2 left-2">
              <Badge variant="signal" size="xs" dot>
                Custom
              </Badge>
            </div>
          )}
        </div>
      </Link>

      <div className="p-3 flex-1 flex flex-col">
        <div className="text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.1em] mb-1 truncate">
          {product.category}
        </div>
        <Link href={detailHref} className="block focus:outline-none">
          <h3 className="text-sm font-semibold text-fg leading-snug line-clamp-2 group-hover:text-signal transition-colors">
            {name}
          </h3>
        </Link>
        <div className="text-[11px] font-mono text-fg-subtle mt-1 truncate">
          {product.sku}
        </div>

        <div className="mt-3 pt-3 border-t border-border flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.1em]">
              {isCustomPrice ? 'Builder price' : 'List'}
            </div>
            <div
              className={cn(
                'text-base font-bold tabular-nums leading-tight',
                isCustomPrice ? 'text-signal' : 'text-fg'
              )}
            >
              {formatCurrency(product.effectivePrice)}
            </div>
            {isCustomPrice &&
              product.builderPrice != null &&
              product.builderPrice < product.basePrice && (
                <div className="text-[10px] text-fg-subtle line-through tabular-nums">
                  {formatCurrency(product.basePrice)}
                </div>
              )}
          </div>
          {showAddButton && (
            <button
              onClick={(e) => {
                e.preventDefault()
                onAdd(product)
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-signal text-fg-on-accent hover:bg-signal/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
              aria-label={`Add ${product.sku} to staged quote`}
              title="Add to staged quote"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Skeleton Grid ───────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <Card key={i} padding="none" className="overflow-hidden">
          <div className="aspect-[4/3] bg-surface-muted animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-2 w-1/3 rounded bg-surface-muted animate-pulse" />
            <div className="h-3 w-4/5 rounded bg-surface-muted animate-pulse" />
            <div className="h-2 w-2/5 rounded bg-surface-muted animate-pulse" />
            <div className="pt-3 border-t border-border flex justify-between">
              <div className="h-5 w-16 rounded bg-surface-muted animate-pulse" />
              <div className="h-7 w-7 rounded bg-surface-muted animate-pulse" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Pagination ──────────────────────────────────────────────────────────────

function Pagination({
  meta,
  onPage,
}: {
  meta: PageMeta
  onPage: (n: number) => void
}) {
  const canPrev = meta.page > 1
  const canNext = meta.page < meta.pages
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={() => canPrev && onPage(meta.page - 1)}
        disabled={!canPrev}
        className="inline-flex items-center justify-center h-7 px-2 rounded-md border border-border bg-surface-muted text-fg-muted hover:text-fg hover:border-border-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs text-fg-muted px-2 tabular-nums">
        {meta.page} / {meta.pages}
      </span>
      <button
        onClick={() => canNext && onPage(meta.page + 1)}
        disabled={!canNext}
        className="inline-flex items-center justify-center h-7 px-2 rounded-md border border-border bg-surface-muted text-fg-muted hover:text-fg hover:border-border-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Cart Drawer ─────────────────────────────────────────────────────────────

function CartDrawer({
  builderName,
  lines,
  total,
  onClose,
  onRemove,
  onQty,
  onClear,
}: {
  builderName: string
  lines: CartLine[]
  total: number
  onClose: () => void
  onRemove: (id: string) => void
  onQty: (id: string, qty: number) => void
  onClear: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
        onClick={onClose}
      />
      <div className="relative ml-auto w-full sm:w-[28rem] h-full bg-surface border-l border-border flex flex-col shadow-2xl animate-[slideInRight_180ms_ease-out]">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-fg">Staged Quote</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              {builderName || 'No builder selected'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <EmptyState
              icon="package"
              title="No items staged"
              description="Add products to stage them for a quote."
              size="compact"
            />
          ) : (
            <ul className="space-y-3">
              {lines.map((l) => (
                <li
                  key={l.productId}
                  className="flex items-start gap-3 pb-3 border-b border-border last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-fg line-clamp-2">
                      {l.name}
                    </div>
                    <div className="text-[11px] font-mono text-fg-subtle mt-0.5">
                      {l.sku}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) =>
                          onQty(l.productId, parseInt(e.target.value, 10) || 1)
                        }
                        className="w-16 h-7 px-2 text-xs bg-surface-muted border border-border rounded-md text-fg focus:outline-none focus:ring-2 focus:ring-signal/40"
                      />
                      <span className="text-xs text-fg-muted tabular-nums">
                        × {formatCurrency(l.unitPrice)} ={' '}
                        <span className="text-fg font-semibold">
                          {formatCurrency(l.unitPrice * l.quantity)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onRemove(l.productId)}
                    className="p-1 rounded text-fg-subtle hover:text-data-negative-fg transition-colors"
                    aria-label="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border space-y-3 bg-surface-muted">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted uppercase tracking-[0.1em] font-semibold">
              Subtotal
            </span>
            <span className="text-lg font-bold text-fg tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>
          <div className="text-[11px] text-fg-subtle leading-snug">
            Items are staged in this browser only. To turn this into a real
            Quote, take the list to the Quotes builder (which requires a
            Takeoff).
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={lines.length === 0}
            >
              Clear
            </Button>
            <Button variant="primary" size="sm" onClick={onClose} fullWidth>
              Continue browsing
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
