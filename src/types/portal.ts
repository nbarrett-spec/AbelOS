/**
 * Builder Portal — TypeScript interfaces.
 *
 * Phase 0.5 of BUILDER-PORTAL-SPEC.md (§5.5).
 *
 * These describe the shapes returned by the existing builder-facing APIs
 * (which already scope by `builderId` from the abel_session cookie). Used
 * by every page under src/app/portal/* and the data-fetching helper at
 * src/lib/portal-api.ts.
 */

import type { ReactNode } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// API Response Types
// ──────────────────────────────────────────────────────────────────────────

export interface AnalyticsResponse {
  monthly: { month: string; orders: number; spend: number }[]
  topProducts: {
    name: string
    sku: string
    category: string
    quantity: number
    spend: number
  }[]
  spendByCategory: { category: string; orders: number; spend: number }[]
  keyMetrics: {
    ytdSpend: number
    ytdOrders: number
    avgOrderValue: number
    approvalRate: number
  }
  quoteStats: { total: number; approved: number; avgDaysToApprove: number }
  paymentStats: { totalInvoices: number; paid: number; overdue: number }
  /** AR (open invoice balance) and avg days from issued → paid. */
  ar?: { balance: number; avgDaysToPay: number | null }
  /** In-flight pipeline counts (active orders / open quotes). */
  pipeline?: { activeOrders: number; openQuotes: number }
  /** Monthly payment history (Payment.amount summed by month, last 12 mo). */
  paymentHistory?: { month: string; count: number; total: number }[]
  /** Last-90d delivery scorecard. on-time = completed on/before scheduled. */
  deliveryPerformance?: {
    windowDays: number
    total: number
    onTime: number
    late: number
    pending: number
    onTimePercent: number
  }
  /** Last-30d activity feed (orders, quotes, invoices) ordered desc by ts. */
  activity?: PortalActivityItem[]
}

export interface PortalActivityItem {
  kind: 'order' | 'quote' | 'invoice'
  id: string
  number: string
  amount: number | null
  status: string
  timestamp: string
}

export interface OrderSearchResponse {
  orders: PortalOrder[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface PortalOrder {
  id: string
  orderNumber: string
  createdAt: string
  status: PortalOrderStatus
  total: number
  itemCount: number
  itemPreview: { name: string; sku: string; quantity: number }[]
}

/**
 * Portal-side order status. The platform's `OrderStatus` enum has more
 * values (RECEIVED, PARTIAL_SHIPPED, etc.) — the portal collapses some
 * of them. Endpoint translates server-side.
 */
export type PortalOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ON_HOLD'

export interface DeliveriesResponse {
  upcoming: PortalDelivery[]
  in_transit: PortalDelivery[]
  completed: PortalDelivery[]
  all: PortalDelivery[]
}

export interface PortalDelivery {
  id: string
  deliveryNumber: string
  jobNumber: string
  address: string
  community: string
  orderNumber: string
  projectName: string
  status: string
  scheduledDate: string
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  notes: string | null
  latestStatus: string | null
  latestLocation: string | null
  latestEta: string | null
  latestTimestamp: string | null
}

export interface CatalogResponse {
  products: CatalogProduct[]
  total: number
  page: number
  totalPages: number
  categories: string[]
  pricingTier: string | null
  hasPricing: boolean
}

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  description: string | null
  category: string
  subcategory: string | null
  basePrice: number
  /** Builder-specific tier price (already overlaid by /api/catalog). */
  builderPrice: number | null
  /** Custom one-off price for this builder + product. */
  customPrice: number | null
  displayName: string | null
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
  stock: number | null
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  priceSource: 'custom' | 'tier' | 'base'
}

// ──────────────────────────────────────────────────────────────────────────
// Component Prop Types
// ──────────────────────────────────────────────────────────────────────────

export interface PortalKPIMetric {
  label: string
  value: number
  /** Currency / unit prefix, e.g. "$" */
  prefix?: string
  /** Suffix, e.g. "%" */
  suffix?: string
  delta?: { value: number; label: string }
  sparklineData?: number[]
  /** CSS variable reference, e.g. "var(--portal-amber)" */
  accentColor: string
}

export interface QuickAction {
  label: string
  icon: ReactNode
  href: string
  description?: string
}

export interface ActivityItem {
  id: string
  icon: ReactNode
  title: string
  description: string
  timestamp: string
  link?: string
}

export interface TimelineStep {
  label: string
  status: 'complete' | 'current' | 'upcoming'
  date?: string
}

export interface PortalNotification {
  id: string
  type: 'order' | 'delivery' | 'quote' | 'invoice'
  title: string
  description: string
  timestamp: string
  read: boolean
  link: string
}

export interface PortalProject {
  id: string
  jobAddress: string
  lotNumber: string | null
  planName: string | null
  community: string
  status: string
  activeOrders: number
  upcomingDeliveries: number
  totalSpend: number
}

// ──────────────────────────────────────────────────────────────────────────
// Role + community context (used by portal layout / providers)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the Prisma PortalRole enum on BuilderContact. Kept as a string
 * literal type here so we don't pull `@prisma/client` into client-side
 * portal bundles.
 */
export type PortalRole = 'PM' | 'EXECUTIVE' | 'ADMIN'

export interface PortalSession {
  builderId: string
  contactId: string | null
  email: string
  companyName: string
  contactName: string | null
  portalRole: PortalRole
}

export interface PortalCommunity {
  id: string
  name: string
  city: string | null
  state: string | null
}
