'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

interface ProductDetail {
  id: string
  sku: string
  name: string
  rawName: string
  description: string | null
  category: string
  subcategory: string | null
  rawCategory: string
  basePrice: number
  builderPrice: number
  priceSource: string
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
  stock: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}

interface Alternative {
  id: string
  sku: string
  name: string
  basePrice: number
  coreType: string | null
  panelStyle: string | null
  material: string | null
  stock: number
  stockStatus: string
}

interface RelatedProduct {
  id: string
  sku: string
  name: string
  basePrice: number
  doorSize: string | null
  stock: number
}

const STOCK_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  IN_STOCK: { label: 'In Stock', color: 'bg-green-100 text-green-700', icon: '🟢' },
  LOW_STOCK: { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-700', icon: '🟡' },
  OUT_OF_STOCK: { label: 'Out of Stock', color: 'bg-red-100 text-red-700', icon: '🔴' },
}

function fmtPrice(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { builder } = useAuth()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [alternatives, setAlternatives] = useState<{ good: Alternative[]; better: Alternative[]; best: Alternative[] }>({ good: [], better: [], best: [] })
  const [related, setRelated] = useState<RelatedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [addingToCart, setAddingToCart] = useState(false)
  const [addedSuccess, setAddedSuccess] = useState(false)
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>(null)

  useEffect(() => {
    if (params.id) fetchProduct()
  }, [params.id])

  async function fetchProduct() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch(`/api/catalog/${params.id}`)
      if (!res.ok) throw new Error('Product not found')
      const data = await res.json()
      setProduct(data.product)
      setAlternatives(data.alternatives)
      setRelated(data.related)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function addToCart(productId: string, qty: number, unitPrice: number, description: string, sku: string) {
    setAddingToCart(true)
    try {
      const res = await fetch('/api/catalog/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId, quantity: qty, unitPrice, description, sku }],
        }),
      })
      if (res.ok) {
        setAddedSuccess(true)
        setTimeout(() => setAddedSuccess(false), 3000)
      }
    } catch (err) {
      console.error('[Catalog] Failed to add product to cart:', err)
    } finally {
      setAddingToCart(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">{error || 'Product not found'}</h2>
        <Link href="/catalog" className="text-[#1B4F72] hover:underline">← Back to Catalog</Link>
      </div>
    )
  }

  const stockBadge = STOCK_BADGE[product.stockStatus]
  const specs = [
    product.doorSize && { label: 'Size', value: product.doorSize },
    product.handing && { label: 'Handing', value: product.handing },
    product.coreType && { label: 'Core Type', value: product.coreType },
    product.panelStyle && { label: 'Panel Style', value: product.panelStyle },
    product.jambSize && { label: 'Jamb Size', value: product.jambSize },
    product.material && { label: 'Material', value: product.material },
    product.fireRating && { label: 'Fire Rating', value: product.fireRating },
    product.hardwareFinish && { label: 'Hardware Finish', value: product.hardwareFinish },
  ].filter(Boolean) as { label: string; value: string }[]

  const hasAlternatives = alternatives.good.length > 0 || alternatives.better.length > 0 || alternatives.best.length > 0

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/catalog" className="hover:text-[#1B4F72]">Catalog</Link>
        <span>/</span>
        <span className="text-gray-400">{product.category}</span>
        <span>/</span>
        <span className="text-gray-900 font-medium">{product.name}</span>
      </div>

      {/* Main Product Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Image */}
        <div className="bg-white rounded-2xl border p-8 flex items-center justify-center min-h-[320px]">
          {product.imageUrl ? (
            // External product image (InFlow / S3) — next/image would require
            // adding remotePatterns for every supplier CDN. Use <img> with
            // explicit dimensions + async decoding for CLS and perf.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.imageAlt || product.name}
              width={320}
              height={320}
              decoding="async"
              className="max-w-full max-h-80 object-contain"
            />
          ) : (
            <div className="text-center text-gray-400">
              <div className="text-6xl mb-2">🚪</div>
              <p className="text-sm">No image available</p>
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-500 font-mono">{product.sku}</span>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${stockBadge.color}`}>
                {stockBadge.icon} {stockBadge.label} ({product.stock})
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{product.category}{product.subcategory ? ` · ${product.subcategory}` : ''}</p>
          </div>

          {product.description && (
            <p className="text-gray-600">{product.description}</p>
          )}

          {/* Pricing */}
          <div className="bg-[#1B4F72]/5 rounded-xl p-5">
            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold text-[#1B4F72]">{fmtPrice(product.builderPrice)}</span>
              {product.priceSource !== 'BASE' && product.builderPrice !== product.basePrice && (
                <span className="text-lg text-gray-400 line-through mb-1">{fmtPrice(product.basePrice)}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {product.priceSource === 'CUSTOM' ? 'Your custom price' : product.priceSource === 'TIER' ? 'Your tier price' : 'List price'}
              {' · per unit'}
            </p>
          </div>

          {/* Quantity + Add to Cart */}
          <div className="flex items-center gap-4">
            <div className="flex items-center border rounded-xl overflow-hidden">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-4 py-3 text-lg font-bold text-gray-600 hover:bg-gray-100 transition"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 text-center text-lg font-semibold border-x py-3 focus:outline-none"
              />
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-4 py-3 text-lg font-bold text-gray-600 hover:bg-gray-100 transition"
              >
                +
              </button>
            </div>
            <button
              onClick={() => addToCart(product.id, quantity, product.builderPrice, product.name, product.sku)}
              disabled={addingToCart || product.stockStatus === 'OUT_OF_STOCK'}
              className={`flex-1 py-3.5 font-bold rounded-xl shadow transition text-lg ${
                addedSuccess
                  ? 'bg-green-500 text-white'
                  : product.stockStatus === 'OUT_OF_STOCK'
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#E67E22] hover:bg-[#D35400] text-white'
              } disabled:opacity-60`}
            >
              {addedSuccess ? '✓ Added to Cart!' : addingToCart ? 'Adding...' : 'Add to Cart'}
            </button>
          </div>

          {/* Line total */}
          {quantity > 1 && (
            <p className="text-sm text-gray-500">
              Line total: <span className="font-semibold text-gray-900">{fmtPrice(product.builderPrice * quantity)}</span>
            </p>
          )}
        </div>
      </div>

      {/* Specifications */}
      {specs.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Specifications</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {specs.map((spec) => (
              <div key={spec.label} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase font-medium">{spec.label}</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{spec.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Good / Better / Best */}
      {hasAlternatives && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Good / Better / Best</h2>
          <p className="text-sm text-gray-500 mb-4">Compare options in the same size and category</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Good */}
            <TierColumn
              tier="Good"
              label="Budget-Friendly"
              color="bg-blue-50 border-blue-200"
              headerColor="text-blue-700"
              items={alternatives.good}
              onAddToCart={addToCart}
              isCurrentProduct={false}
            />
            {/* Better */}
            <TierColumn
              tier="Better"
              label="Most Popular"
              color="bg-green-50 border-green-200"
              headerColor="text-green-700"
              items={alternatives.better}
              onAddToCart={addToCart}
              isCurrentProduct={true}
              currentProductId={product.id}
            />
            {/* Best */}
            <TierColumn
              tier="Best"
              label="Premium"
              color="bg-amber-50 border-amber-200"
              headerColor="text-amber-700"
              items={alternatives.best}
              onAddToCart={addToCart}
              isCurrentProduct={false}
            />
          </div>
        </div>
      )}

      {/* Related Products */}
      {related.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Related Products</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/catalog/${r.id}`}
                className="bg-gray-50 hover:bg-gray-100 rounded-xl p-4 text-center transition"
              >
                <div className="text-3xl mb-2">🚪</div>
                <p className="text-xs font-medium text-gray-900 truncate">{r.name}</p>
                {r.doorSize && <p className="text-xs text-gray-500">{r.doorSize}</p>}
                <p className="text-sm font-bold text-[#1B4F72] mt-1">{fmtPrice(Number(r.basePrice))}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TierColumn({
  tier,
  label,
  color,
  headerColor,
  items,
  onAddToCart,
  isCurrentProduct,
  currentProductId,
}: {
  tier: string
  label: string
  color: string
  headerColor: string
  items: Alternative[]
  onAddToCart: (id: string, qty: number, price: number, name: string, sku: string) => void
  isCurrentProduct: boolean
  currentProductId?: string
}) {
  if (items.length === 0 && !isCurrentProduct) {
    return (
      <div className={`rounded-xl border p-5 ${color} opacity-50`}>
        <h3 className={`text-sm font-bold uppercase ${headerColor}`}>{tier}</h3>
        <p className="text-xs text-gray-500 mt-1">{label}</p>
        <p className="text-sm text-gray-400 mt-4">No alternatives available</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-5 ${color}`}>
      <h3 className={`text-sm font-bold uppercase ${headerColor}`}>{tier}</h3>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      <div className="mt-3 space-y-2">
        {items.slice(0, 3).map((item) => {
          const isThis = item.id === currentProductId
          return (
            <div key={item.id} className={`bg-white rounded-lg p-3 ${isThis ? 'ring-2 ring-[#1B4F72]' : ''}`}>
              <div className="flex items-center justify-between">
                <Link href={`/catalog/${item.id}`} className="text-sm font-medium text-gray-900 hover:text-[#1B4F72] truncate flex-1">
                  {item.name}
                  {isThis && <span className="ml-1 text-xs text-[#1B4F72]">(current)</span>}
                </Link>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold text-[#1B4F72]">{fmtPrice(Number(item.basePrice))}</span>
                {!isThis && (
                  <button
                    onClick={() => onAddToCart(item.id, 1, Number(item.basePrice), item.name, item.sku)}
                    className="text-xs px-2 py-1 bg-[#E67E22] text-white rounded-md hover:bg-[#D35400] transition"
                  >
                    Add
                  </button>
                )}
              </div>
              {item.coreType && <p className="text-xs text-gray-500 mt-1">{item.coreType}{item.material ? ` · ${item.material}` : ''}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
