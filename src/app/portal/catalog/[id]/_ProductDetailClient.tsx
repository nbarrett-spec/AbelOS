'use client'

/**
 * Builder Portal — Product detail client.
 *
 * §4.4.1 Product Detail. Renders:
 *   - Hero (image + name + tier-aware price + add-to-quote CTA)
 *   - Specs grid (door size, handing, material, fire rating, hardware finish)
 *   - Good / Better / Best alternatives (when present)
 *   - Related products
 *
 * "Add to quote" calls /api/cart/add (which reads the abel_quote_cart
 * cookie) and, on success, navigates to /portal/quotes/new.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Boxes,
  Check,
  Hash,
  MessageCircle,
  Plus,
  Sparkles,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'

interface AlternativeProduct {
  id: string
  sku: string
  name: string
  basePrice: number
  coreType?: string | null
  panelStyle?: string | null
  material?: string | null
  stock: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}

interface RelatedProduct {
  id: string
  sku: string
  name: string
  basePrice: number
  doorSize?: string | null
  stock: number
}

export interface ProductDetailPayload {
  product: {
    id: string
    sku: string
    name: string
    rawName?: string
    description: string | null
    category: string
    subcategory: string | null
    rawCategory?: string
    basePrice: number
    builderPrice: number
    priceSource: 'CUSTOM' | 'TIER' | 'BASE' | string
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
  alternatives: {
    good: AlternativeProduct[]
    better: AlternativeProduct[]
    best: AlternativeProduct[]
  }
  related: RelatedProduct[]
}

const STOCK_BADGE: Record<
  'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK',
  { bg: string; fg: string; label: string }
> = {
  IN_STOCK:     { bg: 'rgba(56,128,77,0.12)',  fg: '#1A4B21', label: 'In Stock' },
  LOW_STOCK:    { bg: 'rgba(212,165,74,0.16)', fg: '#7A5413', label: 'Low Stock' },
  OUT_OF_STOCK: { bg: 'rgba(110,42,36,0.10)',  fg: '#7E2417', label: 'Out of Stock' },
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

interface ProductDetailClientProps {
  detail: ProductDetailPayload
}

export function ProductDetailClient({ detail }: ProductDetailClientProps) {
  const router = useRouter()
  const { product, alternatives, related } = detail
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [qty, setQty] = useState(1)

  async function handleAddToQuote() {
    if (adding) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/catalog/cart', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          quantity: qty,
          unitPrice: product.builderPrice,
          description: product.name,
          sku: product.sku,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to add to cart')
      }
      setAdded(true)
      setTimeout(() => router.push('/portal/quotes/new'), 600)
    } catch (e: any) {
      setAddError(e?.message || 'Add failed')
      setAdding(false)
    }
  }

  const hasImage = !!product.imageUrl || !!product.thumbnailUrl
  const stock = STOCK_BADGE[product.stockStatus]
  const imgSrc = product.imageUrl || product.thumbnailUrl || undefined
  const isCustomPrice = product.priceSource === 'CUSTOM'
  const isTierPrice = product.priceSource === 'TIER'
  const showSavings = product.builderPrice < product.basePrice

  const specs: { label: string; value: string | null }[] = [
    { label: 'SKU', value: product.sku },
    { label: 'Door Size', value: product.doorSize },
    { label: 'Handing', value: product.handing },
    { label: 'Core', value: product.coreType },
    { label: 'Panel', value: product.panelStyle },
    { label: 'Jamb', value: product.jambSize },
    { label: 'Material', value: product.material },
    { label: 'Fire Rating', value: product.fireRating },
    { label: 'Hardware Finish', value: product.hardwareFinish },
  ].filter((s) => !!s.value)

  return (
    <div className="space-y-6">
      <Link
        href="/portal/catalog"
        className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        style={{ color: 'var(--c1)' }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to catalog
      </Link>

      {/* Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="aspect-[4/3] rounded-[14px] overflow-hidden relative"
          style={{
            background:
              'var(--portal-bg-elevated, linear-gradient(135deg, #FAF5E8, #F0E8DA))',
            border: '1px solid var(--portal-border-light, #F0E8DA)',
          }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={product.imageAlt || product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-xs uppercase tracking-wider font-semibold"
              style={{ color: 'var(--portal-text-subtle)' }}
            >
              {product.category}
            </div>
          )}
          <span
            className="absolute top-3 right-3 inline-flex items-center px-2 py-1 rounded-full text-[11px] font-medium"
            style={{ background: stock.bg, color: stock.fg }}
          >
            {stock.label}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <div
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--portal-text-subtle)' }}
            >
              {product.category}
              {product.subcategory ? ` · ${product.subcategory}` : ''}
            </div>
            <h1
              className="mt-1 text-2xl md:text-3xl font-medium leading-tight"
              style={{
                fontFamily: 'var(--font-portal-display)',
                color: 'var(--portal-text-strong, #3E2A1E)',
                letterSpacing: '-0.02em',
              }}
            >
              {product.name}
            </h1>
            <div
              className="text-xs font-mono mt-1"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              {product.sku}
            </div>
          </div>

          {product.description && (
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--portal-text, #2C2C2C)' }}
            >
              {product.description}
            </p>
          )}

          {/* Pricing block */}
          <div
            className="rounded-[14px] p-4"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(62,42,30,0.04))',
            }}
          >
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <div
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {isCustomPrice
                    ? 'Your custom price'
                    : isTierPrice
                      ? 'Your tier price'
                      : 'List price'}
                </div>
                <div
                  className="text-3xl font-semibold tabular-nums"
                  style={{
                    fontFamily: 'var(--font-portal-display)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  ${fmtUsd(product.builderPrice)}
                </div>
              </div>
              {showSavings && (
                <div className="text-sm">
                  <span
                    className="line-through tabular-nums"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    ${fmtUsd(product.basePrice)}
                  </span>
                  <span
                    className="ml-2 font-medium"
                    style={{ color: 'var(--portal-success, #1A4B21)' }}
                  >
                    Save{' '}
                    {Math.round(
                      ((product.basePrice - product.builderPrice) /
                        product.basePrice) *
                        100,
                    )}
                    %
                  </span>
                </div>
              )}
              {(isCustomPrice || isTierPrice) && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    background: 'rgba(201,130,43,0.12)',
                    color: '#7A4E0F',
                    border: '1px solid rgba(201,130,43,0.2)',
                  }}
                >
                  <Sparkles className="w-3 h-3" />
                  {isCustomPrice ? 'Negotiated' : 'Tier'}
                </span>
              )}
            </div>

            {/* Qty + CTA */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="h-9 w-9 inline-flex items-center justify-center text-sm transition-colors hover:bg-[var(--portal-bg-elevated)]"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    borderRight: 'none',
                  }}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="h-9 w-14 text-center text-sm tabular-nums font-mono focus:outline-none focus:ring-1 focus:ring-[var(--c1)]"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                  }}
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => q + 1)}
                  className="h-9 w-9 inline-flex items-center justify-center text-sm transition-colors hover:bg-[var(--portal-bg-elevated)]"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    borderLeft: 'none',
                  }}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddToQuote}
                disabled={adding || added}
                className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-80"
                style={{
                  background: added
                    ? 'var(--portal-success, #1A4B21)'
                    : 'var(--grad)',
                  color: 'white',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {added ? (
                  <>
                    <Check className="w-4 h-4" />
                    Added to quote
                  </>
                ) : adding ? (
                  <>Adding…</>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Add to quote
                  </>
                )}
              </button>
              <Link
                href="/portal/messages"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                }}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Ask
              </Link>
            </div>
            {addError && (
              <div
                className="mt-2 text-xs"
                style={{ color: 'var(--portal-oxblood, #7E2417)' }}
              >
                {addError}
              </div>
            )}
          </div>

          {/* Specs */}
          {specs.length > 0 && (
            <PortalCard title="Specifications">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                {specs.map((s) => (
                  <div key={s.label}>
                    <dt
                      className="text-[10px] uppercase tracking-wider font-semibold"
                      style={{ color: 'var(--portal-text-subtle)' }}
                    >
                      {s.label}
                    </dt>
                    <dd
                      className="text-sm mt-0.5"
                      style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                    >
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </PortalCard>
          )}
        </div>
      </div>

      {/* Good / Better / Best */}
      {(alternatives.good.length > 0 ||
        alternatives.better.length > 0 ||
        alternatives.best.length > 0) && (
        <PortalCard
          title="Good · Better · Best"
          subtitle="Same size, different price points"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TierColumn
              tier="Good"
              accent="rgba(140,168,184,0.16)"
              accentFg="#3D5A6A"
              alternatives={alternatives.good}
            />
            <TierColumn
              tier="Better"
              accent="rgba(201,130,43,0.14)"
              accentFg="#7A4E0F"
              alternatives={alternatives.better}
            />
            <TierColumn
              tier="Best"
              accent="rgba(62,42,30,0.10)"
              accentFg="var(--c1)"
              alternatives={alternatives.best}
            />
          </div>
        </PortalCard>
      )}

      {/* Related products */}
      {related.length > 0 && (
        <PortalCard title="You may also need">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/portal/catalog/${r.id}`}
                className="block p-3 rounded-md transition-colors hover:bg-[var(--portal-bg-elevated)]"
                style={{
                  border: '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <div
                  className="text-[11px] font-mono mb-1"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {r.sku}
                </div>
                <div
                  className="text-sm font-medium leading-tight line-clamp-2"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  {r.name}
                </div>
                <div
                  className="text-xs mt-2 tabular-nums font-mono"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  ${fmtUsd(r.basePrice)}
                </div>
              </Link>
            ))}
          </div>
        </PortalCard>
      )}
    </div>
  )
}

function TierColumn({
  tier,
  accent,
  accentFg,
  alternatives,
}: {
  tier: string
  accent: string
  accentFg: string
  alternatives: AlternativeProduct[]
}) {
  if (alternatives.length === 0) {
    return (
      <div
        className="rounded-md p-3 text-xs"
        style={{
          background: 'var(--portal-bg-elevated, #FAF5E8)',
          border: '1px dashed var(--portal-border, #E8DFD0)',
          color: 'var(--portal-text-muted, #6B6056)',
        }}
      >
        <div
          className="inline-flex items-center px-2 py-0.5 rounded-full font-medium mb-2"
          style={{ background: accent, color: accentFg }}
        >
          {tier}
        </div>
        <p>None at this tier.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
        style={{ background: accent, color: accentFg }}
      >
        {tier}
      </span>
      {alternatives.slice(0, 3).map((alt) => (
        <Link
          key={alt.id}
          href={`/portal/catalog/${alt.id}`}
          className="block p-3 rounded-md transition-colors hover:bg-[var(--portal-bg-elevated)]"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border-light, #F0E8DA)',
          }}
        >
          <div
            className="text-[11px] font-mono mb-1 flex items-center gap-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Hash className="w-3 h-3" />
            {alt.sku}
          </div>
          <div
            className="text-sm font-medium leading-tight line-clamp-2 mb-1"
            style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
          >
            {alt.name}
          </div>
          <div className="flex items-center justify-between">
            <span
              className="text-xs tabular-nums font-mono"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              ${fmtUsd(alt.basePrice)}
            </span>
            <span
              className="text-[10px]"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              <Boxes className="w-3 h-3 inline mr-0.5" />
              {alt.stock}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
