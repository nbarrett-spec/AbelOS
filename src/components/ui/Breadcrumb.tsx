import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

// ── Aegis v2 "Drafting Room" Breadcrumb ──────────────────────────────────
// Usage:
//   <Breadcrumb items={[
//     { label: 'Ops', href: '/ops' },
//     { label: 'Jobs', href: '/ops/jobs' },
//     { label: 'Job #4821' }, // last item, current page (no href)
//   ]} />
// ─────────────────────────────────────────────────────────────────────────

export type BreadcrumbItem = {
  label: string
  href?: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={className}
    >
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <Fragment key={`${i}-${item.label}`}>
              <li className="flex items-center">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="text-fg-muted hover:text-signal transition-colors"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="text-fg"
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="flex items-center text-fg-subtle">
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumb
