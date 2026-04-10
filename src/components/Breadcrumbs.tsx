'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Human-readable labels for URL segments
const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  quotes: 'Quotes',
  invoices: 'Invoices',
  deliveries: 'Deliveries',
  warranty: 'Warranty',
  messages: 'Messages',
  notifications: 'Notifications',
  settings: 'Account Settings',
  projects: 'Projects',
  catalog: 'Catalog',
  ops: 'Operations',
  purchasing: 'Purchase Orders',
  inventory: 'Inventory',
  crews: 'Crews',
  schedule: 'Schedule & Dispatch',
  'builder-messages': 'Builder Messages',
  financial: 'Financial',
  sales: 'Sales',
  pipeline: 'Pipeline',
  analytics: 'Analytics',
  reports: 'Reports',
  contracts: 'Contracts',
  admin: 'Admin',
  builders: 'Builders',
  register: 'Register',
  'quote-requests': 'Quote Requests',
  'job-pipeline': 'Job Pipeline',
  'product-catalog': 'Product Catalog',
  'builder-accounts': 'Builder Accounts',
  'warranty-claims': 'Warranty Claims',
  'warranty-policies': 'Warranty Policies',
  'sales-dashboard': 'Sales Dashboard',
  'sales-reports': 'Sales Reports',
  'sales-analytics': 'Sales Analytics',
  'document-requests': 'Document Requests',
  'builder-applications': 'Builder Applications',
  organizations: 'Organizations',
  communities: 'Communities',
  'takeoff-inquiries': 'Takeoff Inquiries',
  'takeoff-review': 'Takeoff Review',
  manufacturing: 'Manufacturing',
  'pick-lists': 'Pick Lists',
  'quality-control': 'Quality Control',
  staging: 'Staging',
  vendors: 'Vendors',
  'ceo-dashboard': 'CEO Dashboard',
  'reports-analytics': 'Reports & Analytics',
}

// Segments that should be skipped in breadcrumbs (route groups, etc.)
const SKIP_SEGMENTS = ['(auth)', '(dashboard)']

// Root paths for different portals
const PORTAL_ROOTS: Record<string, { label: string; href: string }> = {
  dashboard: { label: 'Dashboard', href: '/dashboard' },
  ops: { label: 'Operations', href: '/ops' },
  sales: { label: 'Sales Portal', href: '/sales' },
  admin: { label: 'Admin', href: '/admin' },
}

interface BreadcrumbsProps {
  /** Override the auto-generated page title (last breadcrumb) */
  currentLabel?: string
  className?: string
}

export default function Breadcrumbs({ currentLabel, className = '' }: BreadcrumbsProps) {
  const pathname = usePathname()

  // Split and filter segments
  const segments = pathname
    .split('/')
    .filter(s => s && !SKIP_SEGMENTS.includes(s))

  // Don't show breadcrumbs on root portal pages (e.g. /dashboard, /ops)
  if (segments.length <= 1) return null

  // Build breadcrumb items
  const items: { label: string; href: string }[] = []
  let currentPath = ''

  segments.forEach((segment, index) => {
    currentPath += '/' + segment

    // Check if this looks like a dynamic ID (contains numbers or is very long)
    const isDynamicId = /^[a-z0-9]{8,}$/i.test(segment) || /^\d+$/.test(segment) || segment.startsWith('SO-') || segment.startsWith('PO-')

    const label = isDynamicId
      ? segment.toUpperCase()
      : LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')

    items.push({
      label: index === segments.length - 1 && currentLabel ? currentLabel : label,
      href: currentPath,
    })
  })

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-sm text-gray-500 mb-4 ${className}`}>
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-1.5">
          {i > 0 && (
            <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
          {i < items.length - 1 ? (
            <Link href={item.href} className="hover:text-[#1B4F72] transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
