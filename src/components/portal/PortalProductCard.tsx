'use client'

/**
 * Catalog product card.
 *
 * §4.4 Catalog. Wraps Magic UI's `MagicCard` with portal tokens, builder
 * pricing, stock pill, and a category caption. The card is fully clickable
 * (anchor wraps the whole thing) so the hover-cursor + focus ring read as
 * a single interaction surface.
 */

import Link from 'next/link'
import { MagicCard } from '@/components/magicui/magic-card'
import type { CatalogProduct } from '@/types/portal'

interface PortalProductCardProps {
  product: CatalogProduct
  /** When true (logged-in builder), show builder price; otherwise show base. */
  showBuilderPrice?: boolean
  className?: string
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

const STOCK_BADGE: Record<
  CatalogProduct['stockStatus'],
  { bg: string; fg: string; label: string }
> = {
  IN_STOCK:     { bg: 'rgba(56,128,77,0.12)',  fg: '#1A4B21', label: 'In Stock' },
  LOW_STOCK:    { bg: 'rgba(212,165,74,0.16)', fg: '#7A5413', label: 'Low Stock' },
  OUT_OF_STOCK: { bg: 'rgba(110,42,36,0.10)',  fg: '#7E2417', label: 'Out' },
}

export function PortalProductCard({
  product,
  showBuilderPrice = true,
  className,
}: PortalProductCardProps) {
  const price =
    showBuilderPrice && product.builderPrice != null
      ? product.builderPrice
      : product.basePrice
  const stock = STOCK_BADGE[product.stockStatus]
  const name = product.displayName || product.name
  const hasImage = !!product.thumbnailUrl || !!product.imageUrl
  const imgSrc = product.thumbnailUrl || product.imageUrl || undefined

  return (
    <Link
      href={`/portal/catalog/${product.id}`}
      className={`group block rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-amber,#C9822B)] focus-visible:ring-offset-2 ${
        className ?? ''
      }`}
      aria-label={`View ${name}`}
    >
      <MagicCard
        gradientFrom="#C9822B"
        gradientTo="#D4A54A"
        gradientColor="rgba(201,130,43,0.12)"
        gradientOpacity={0.6}
        gradientSize={180}
        className="h-full rounded-[14px]"
      >
        <div
          className="relative h-full p-3 flex flex-col"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            borderRadius: 'inherit',
          }}
        >
          {/* Image / placeholder */}
          <div
            className="aspect-[4/3] rounded-md overflow-hidden mb-3 relative"
            style={{
              background:
                'var(--portal-bg-elevated, linear-gradient(135deg, #FAF5E8, #F0E8DA))',
            }}
          >
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgSrc}
                alt={product.imageAlt || name}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
              >
                {product.category.slice(0, 14)}
              </div>
            )}
            <span
              className="absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
              style={{ background: stock.bg, color: stock.fg }}
            >
              {stock.label}
            </span>
          </div>

          {/* Caption */}
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] uppercase tracking-wider font-semibold mb-1"
              style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
            >
              {product.category}
            </div>
            <h3
              className="text-sm font-medium leading-snug line-clamp-2"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {name}
            </h3>
            <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
              {product.sku}
            </div>
          </div>

          {/* Price footer */}
          <div
            className="mt-3 pt-3 flex items-end justify-between"
            style={{ borderTop: '1px solid var(--portal-border-light, #F0E8DA)' }}
          >
            <div>
              <div
                className="text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              >
                {product.priceSource === 'custom'
                  ? 'Your Price'
                  : product.priceSource === 'tier'
                    ? 'Tier Price'
                    : 'List'}
              </div>
              <div
                className="text-base font-semibold tabular-nums"
                style={{
                  fontFamily: 'var(--font-portal-display, Georgia)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                  letterSpacing: '-0.01em',
                }}
              >
                {fmtUsd(price)}
              </div>
            </div>
            {showBuilderPrice &&
              product.builderPrice != null &&
              product.builderPrice < product.basePrice && (
                <div
                  className="text-[10px] line-through tabular-nums"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {fmtUsd(product.basePrice)}
                </div>
              )}
          </div>
        </div>
      </MagicCard>
    </Link>
  )
}
