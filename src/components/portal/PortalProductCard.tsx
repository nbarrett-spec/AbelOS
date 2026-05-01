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
      className={`group block rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c1)] focus-visible:ring-offset-2 ${
        className ?? ''
      }`}
      aria-label={`View ${name}`}
    >
      <MagicCard
        gradientFrom="#4F46E5"
        gradientTo="#06B6D4"
        gradientColor="rgba(79,70,229,0.12)"
        gradientOpacity={0.6}
        gradientSize={180}
        className="h-full rounded-[14px]"
      >
        <div
          className="relative h-full p-3 flex flex-col"
          style={{
            background: 'var(--glass)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            borderRadius: 'inherit',
          }}
        >
          {/* Image / placeholder */}
          <div
            className="aspect-[4/3] rounded-md overflow-hidden mb-3 relative"
            style={{
              background:
                'linear-gradient(135deg, rgba(79,70,229,0.05), rgba(6,182,212,0.05))',
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
              <div className="w-full h-full flex items-center justify-center portal-meta-label">
                {product.category.slice(0, 14)}
              </div>
            )}
            <span
              className="absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px]"
              style={{
                background: stock.bg,
                color: stock.fg,
                fontFamily: 'var(--font-portal-mono)',
                fontWeight: 600,
                letterSpacing: '0.06em',
              }}
            >
              {stock.label}
            </span>
          </div>

          {/* Caption */}
          <div className="flex-1 min-w-0">
            <div className="portal-meta-label mb-1">
              {product.category}
            </div>
            <h3
              className="leading-snug line-clamp-2"
              style={{
                fontFamily: 'var(--font-portal-display)',
                fontSize: 18,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--portal-text-strong)',
              }}
            >
              {name}
            </h3>
            <div
              className="text-[11px] portal-mono-data mt-1"
              style={{ color: 'var(--portal-text-subtle)' }}
            >
              {product.sku}
            </div>
          </div>

          {/* Price footer */}
          <div
            className="mt-3 pt-3 flex items-end justify-between"
            style={{ borderTop: '1px dashed var(--bp-annotation)' }}
          >
            <div>
              <div className="portal-meta-label">
                {product.priceSource === 'custom'
                  ? 'Your Price'
                  : product.priceSource === 'tier'
                    ? 'Tier Price'
                    : 'List'}
              </div>
              <div
                className="portal-mono-data mt-0.5"
                style={{
                  fontSize: 17,
                  color: 'var(--portal-text-strong)',
                  fontWeight: 600,
                }}
              >
                {fmtUsd(price)}
              </div>
            </div>
            {showBuilderPrice &&
              product.builderPrice != null &&
              product.builderPrice < product.basePrice && (
                <div
                  className="text-[10px] line-through portal-mono-data"
                  style={{ color: 'var(--portal-text-subtle)' }}
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
