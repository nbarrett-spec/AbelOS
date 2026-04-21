'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: string
  href?: string
}

export interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  crumbs?: Crumb[]
  /** Right-side action slot (buttons, filters, etc.) */
  actions?: ReactNode
  /** Content below title (tabs, filter chips) */
  children?: ReactNode
  className?: string
}

export function Breadcrumb({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  if (!crumbs || crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 text-xs text-fg-muted', className)}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {c.href && !isLast ? (
              <Link href={c.href} className="hover:text-fg transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-fg' : ''}>{c.label}</span>
            )}
            {!isLast && <ChevronRight className="w-3 h-3 text-fg-subtle" />}
          </span>
        )
      })}
    </nav>
  )
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  crumbs,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-6', className)}>
      {crumbs && <Breadcrumb crumbs={crumbs} className="mb-2" />}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
          <h1 className="text-display-lg text-fg truncate">{title}</h1>
          {description && (
            <p className="text-sm text-fg-muted mt-1 max-w-2xl">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  )
}
