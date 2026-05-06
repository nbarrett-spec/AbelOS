'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import { canAccessRoute, type PortalOverrides } from '@/lib/permissions'
import { NotificationBell } from './components/NotificationBell'
import { GlobalSearch } from './components/GlobalSearch'
import AICopilot from './components/AICopilot'
import TaskPanel from './components/TaskPanel'
import ThemeProvider from './components/ThemeProvider'
import AegisBackground from '@/components/AegisBackground'
import PortalBackground from '@/components/PortalBackground'
import PageBackground from '@/components/PageBackground'
import { getSectionForPath } from '@/lib/page-backgrounds'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Tooltip from '@/components/ui/Tooltip'
import CommandMenu, { useCommandMenu } from '@/components/ui/CommandMenu'
import ShortcutsOverlay from '@/components/ui/ShortcutsOverlay'
import StatusBar from '@/components/ui/StatusBar'
import { SystemPulse } from '@/components/SystemPulse'
import LiveClock from '@/components/ui/LiveClock'
import HealthChip from '@/components/ui/HealthChip'
import HelpPanel from '@/components/HelpPanel'
import LiveDataIndicator from '@/components/ui/LiveDataIndicator'
import RecentActivityDrawer from '@/components/ui/RecentActivityDrawer'
import DensityToggle from '@/components/ui/DensityToggle'
import SyncChip from '@/components/ui/SyncChip'
import { useLiveTick } from '@/hooks/useLiveTopic'
import type { StaffRole } from '@/lib/permissions'
import {
  BarChart3, Briefcase, Truck, Settings, TrendingUp, Wrench, Calendar, HardHat, Target, FileText,
  File, ClipboardList, DollarSign, Brain, Mail, Megaphone, Phone, Building2, Inbox, Building,
  Home, CircleDollarSign, ShoppingCart, RefreshCw, Search, Ruler, Package, Shield, ScrollText,
  Factory, Cog, CheckCircle, Banknote, Printer, Smartphone, Scale, Bot, Download, Map,
  Heart, Sparkles, Zap, Handshake, Link2, TreePine, Archive, FolderOpen, Users, User, Trophy,
  MessageSquare, MailOpen, Bell, Wallet, Landmark, Sun, ChevronLeft, ChevronRight,
  PanelLeftClose, PanelLeft, Menu, LogOut, ExternalLink, ChevronDown, CreditCard, Key,
  BookOpen, Library,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: string
  /** If set, shows a live counter badge on this nav item */
  badgeKey?: 'inbox'
}

interface NavSection {
  label: string
  id: string
  items: NavItem[]
}

// ── Icon Map ───────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  '📊': BarChart3, '👔': Briefcase, '🚚': Truck, '⚙️': Settings, '📈': TrendingUp,
  '🔧': Wrench, '📅': Calendar, '👷': HardHat, '🎯': Target, '📝': FileText,
  '📄': File, '📋': ClipboardList, '💰': DollarSign, '🧠': Brain, '📧': Mail,
  '📣': Megaphone, '📞': Phone, '🏗️': Building2, '📨': Inbox, '🏢': Building,
  '🏘️': Home, '💲': CircleDollarSign, '🛒': ShoppingCart, '🔄': RefreshCw,
  '🔍': Search, '📐': Ruler, '📦': Package, '🛡️': Shield, '📜': ScrollText,
  '🏭': Factory, '🔩': Cog, '✅': CheckCircle, '💵': Banknote, '🖨️': Printer,
  '📱': Smartphone, '⚖️': Scale, '🤖': Bot, '📥': Download, '🗺️': Map,
  '❤️': Heart, '🔮': Sparkles, '⚡': Zap, '🤝': Handshake, '🔗': Link2,
  '🌲': TreePine, '🗄️': Archive, '📁': FolderOpen, '👥': Users, '👤': User,
  '💬': MessageSquare, '📩': MailOpen, '🔔': Bell, '💸': Wallet, '🏦': Landmark, '💳': CreditCard,
  '☀️': Sun, '📍': Target, '🏷️': Package, '🚛': Truck, '💡': Sparkles, '🔬': Sparkles, '🏆': Trophy,
  '🔑': Key, '📒': BookOpen, '📚': Library,
  '⚔️': Sparkles, '💹': TrendingUp, '🚀': TrendingUp, '🏛️': Building, '📉': TrendingUp, '🎓': FileText,
}

// ── Navigation Sections ────────────────────────────────────────────────────

// Workflow-based grouping (audit B-UX-5). Items map to the user's mental model
// rather than entity type. Some hrefs intentionally appear in two groups
// (e.g. /ops/finance both as Executive snapshot and Finance hub) — preserved
// to keep parity with the prior structure.
const NAV_SECTIONS: NavSection[] = [
  // 1. DASHBOARD — combines OVERVIEW + EXECUTIVE
  {
    label: 'DASHBOARD', id: 'dashboard',
    items: [
      { href: '/ops', label: 'Dashboard', icon: '📊' },
      { href: '/ops/my-day', label: 'My Day', icon: '☀️' },
      { href: '/ops/inbox', label: 'Inbox', icon: '📨', badgeKey: 'inbox' },
      { href: '/ops/executive', label: 'CEO Dashboard', icon: '👔' },
      { href: '/ops/kpis', label: 'KPIs', icon: '📊' },
      { href: '/ops/reports', label: 'Reports & Analytics', icon: '📊' },
      { href: '/ops/reports/shipping-forecast', label: 'Shipping Forecast', icon: '🚚' },
      { href: '/ops/executive/operations', label: 'Operations', icon: '⚙️' },
      { href: '/ops/finance', label: 'Financial', icon: '📈' },
      { href: '/executive', label: 'Executive Suite', icon: '🏛️' },
      { href: '/ops/admin/trends', label: 'Trend Tracker', icon: '📉' },
    ],
  },
  // 2. SALES — Deals, Quotes, Orders, Builders, Communities, Pipeline,
  //           Growth Engine, Marketing/Outreach, Customer Value
  {
    label: 'SALES', id: 'sales',
    items: [
      // Sales Pipeline
      { href: '/ops/sales', label: 'Sales Dashboard', icon: '🎯' },
      { href: '/ops/sales/command-center', label: 'Sales Command Center', icon: '🎯' },
      { href: '/ops/sales/intelligence', label: 'Sales Intelligence', icon: '🧠' },
      { href: '/ops/sales/reports', label: 'Sales Reports', icon: '📊' },
      { href: '/ops/sales/analytics', label: 'Sales Analytics', icon: '📈' },
      // Quotes / Orders / Contracts
      { href: '/ops/quote-requests', label: 'Quote Requests', icon: '📋' },
      { href: '/ops/quotes', label: 'Quotes', icon: '💲' },
      { href: '/ops/quotes/conversion', label: 'Quote Conversion', icon: '🔄' },
      { href: '/ops/orders', label: 'Orders', icon: '📄' },
      { href: '/ops/orders/ai-processing', label: 'AI Order Center', icon: '🤖' },
      { href: '/ops/sales/contracts', label: 'Contracts', icon: '📝' },
      { href: '/ops/sales/documents', label: 'Document Requests', icon: '📄' },
      { href: '/ops/takeoff-inquiries', label: 'Takeoff Inquiries', icon: '📨' },
      { href: '/ops/takeoff-review', label: 'Takeoff Review', icon: '🔍' },
      { href: '/ops/floor-plans', label: 'Floor Plans', icon: '📐' },
      // Pricing
      { href: '/ops/pricing', label: 'Pricing Engine', icon: '💰' },
      { href: '/ops/margin-rules', label: 'Margin Protection', icon: '🛡️' },
      // Builders / Accounts / Communities
      { href: '/ops/accounts', label: 'Builder Accounts', icon: '🏗️' },
      { href: '/ops/accounts/applications', label: 'Builder Applications', icon: '📨' },
      { href: '/ops/accounts/proactive', label: 'Proactive Accounts', icon: '🤝' },
      { href: '/ops/customers/health', label: 'Builder Health Scores', icon: '📊' },
      { href: '/ops/portal/builder-intel', label: 'Builder Intelligence', icon: '🔍' },
      { href: '/ops/organizations', label: 'Organizations', icon: '🏢' },
      { href: '/ops/communities', label: 'Communities', icon: '🏘️' },
      { href: '/ops/trades', label: 'Trade Finder', icon: '🤝' },
      { href: '/dashboard/onboarding', label: 'Builder Onboarding', icon: '🎓' },
      // Growth Engine / Marketing / Outreach
      { href: '/ops/growth', label: 'Growth Opportunities', icon: '🚀' },
      { href: '/ops/growth/leads', label: 'Lead Scoring & CLV', icon: '🎯' },
      { href: '/ops/growth/permits', label: 'Permit Pipeline', icon: '🗺️' },
      { href: '/ops/marketing/campaigns', label: 'Marketing Automation', icon: '📣' },
      { href: '/ops/sales/outreach', label: 'Outreach Sequences', icon: '📧' },
      { href: '/ops/outreach/tracker', label: 'Cold Outreach', icon: '📞' },
      { href: '/ops/revenue-intelligence', label: 'AI Revenue Machine', icon: '💰' },
      { href: '/ops/customer-catalog', label: 'Customer Catalog', icon: '🛒' },
      // Communication (customer-facing belongs in Sales workflow)
      { href: '/ops/messages', label: 'Messages', icon: '💬' },
      { href: '/ops/builder-messages', label: 'Builder Inbox', icon: '📩' },
      { href: '/ops/communication-log', label: 'Communication Log', icon: '📧' },
      { href: '/ops/notifications', label: 'Notifications', icon: '🔔' },
      { href: '/ops/gchat', label: 'Google Chat', icon: '💬' },
      { href: '/ops/video-rooms', label: 'Video Rooms', icon: '📹' },
      { href: '/ops/agent', label: 'AI Agent Dashboard', icon: '🤖' },
    ],
  },
  // 3. OPS — Jobs, Manufacturing, Deliveries, QC, Calendar, Schedule, Crews,
  //          Warehouse/NFC, Warranty, Fleet
  {
    label: 'OPS', id: 'ops',
    items: [
      // Jobs & Projects
      { href: '/ops/projects', label: 'PM Command Center', icon: '🎛️' },
      { href: '/ops/jobs', label: 'Job Pipeline', icon: '🔧' },
      { href: '/ops/job-readiness', label: 'Job Readiness', icon: '✅' },
      { href: '/ops/material-calendar', label: 'Material Calendar', icon: '📅' },
      { href: '/ops/schedule', label: 'Schedule & Dispatch', icon: '📅' },
      { href: '/ops/crews', label: 'Crews', icon: '👷' },
      { href: '/ops/inspections', label: 'Inspections', icon: '✅' },
      { href: '/ops/lien-releases', label: 'Lien Releases', icon: '📜' },
      { href: '/ops/jobs/map', label: 'Live Jobsite Map', icon: '🗺️' },
      // Manufacturing
      { href: '/ops/manufacturing', label: 'Manufacturing Dashboard', icon: '🏭' },
      { href: '/ops/manufacturing/build-sheet', label: 'Build Sheet', icon: '📝' },
      { href: '/ops/manufacturing/bom', label: 'Bill of Materials', icon: '🔩' },
      { href: '/ops/manufacturing/picks', label: 'Pick Lists', icon: '📋' },
      { href: '/ops/manufacturing/qc', label: 'Quality Control', icon: '✅' },
      { href: '/ops/manufacturing/staging', label: 'Staging', icon: '📦' },
      { href: '/ops/manufacturing/labor-costs', label: 'Labor & Overhead', icon: '💵' },
      { href: '/ops/manufacturing/job-packet', label: 'Print Job Packet', icon: '🖨️' },
      // Warehouse & NFC
      { href: '/ops/warehouse/pick-scanner', label: 'Pick Scanner', icon: '📱' },
      { href: '/ops/warehouse/bays', label: 'Bay Map', icon: '🏭' },
      { href: '/ops/warehouse/doors', label: 'Door Registry', icon: '📱' },
      // Delivery / Fleet
      { href: '/ops/delivery', label: 'Delivery Center', icon: '🚚' },
      { href: '/ops/delivery/today', label: 'Today\'s Routes', icon: '🛻' },
      { href: '/ops/delivery/manifest', label: 'Print Manifest', icon: '🖨️' },
      { href: '/ops/delivery/route-optimizer', label: 'Route Optimizer', icon: '🗺️' },
      { href: '/ops/delivery/optimize', label: 'Delivery Analytics', icon: '📊' },
      { href: '/ops/delivery/curri', label: 'Curri (3rd Party)', icon: '🤝' },
      { href: '/ops/fleet', label: 'Fleet & Logistics Hub', icon: '🚛' },
      // Warranty
      { href: '/ops/warranty', label: 'Warranty Claims', icon: '🛡️' },
      { href: '/ops/warranty/policies', label: 'Warranty Policies', icon: '📜' },
      { href: '/ops/warranty/automation', label: 'Warranty Automation', icon: '🛡️' },
    ],
  },
  // 4. INVENTORY — Products, Stock Levels, Purchasing, Vendors, Receiving,
  //                Returns, Substitutions, MRP, Supply Chain
  {
    label: 'INVENTORY', id: 'inventory',
    items: [
      // Products / Catalog
      { href: '/ops/products', label: 'Product Catalog', icon: '📦' },
      { href: '/ops/products/profitability', label: 'Product Profitability', icon: '💹' },
      { href: '/ops/catalog', label: 'Categories & Suppliers', icon: '🏷️' },
      // Stock Levels
      { href: '/ops/inventory', label: 'Inventory', icon: '📦' },
      { href: '/ops/inventory/intelligence', label: 'Inventory Intelligence', icon: '🧠' },
      { href: '/ops/inventory/allocations', label: 'Allocations', icon: '📍' },
      // Purchasing
      { href: '/ops/purchasing', label: 'Purchase Orders', icon: '🛒' },
      { href: '/ops/purchasing/smart-po', label: 'SmartPO Queue', icon: '⚡' },
      { href: '/ops/purchasing/optimize', label: 'Purchasing Optimizer', icon: '⚖️' },
      { href: '/ops/auto-po', label: 'Auto-PO Generation', icon: '⚡' },
      { href: '/ops/procurement-intelligence', label: 'AI Procurement Brain', icon: '🤖' },
      { href: '/ops/mrp', label: 'MRP — Forward Demand', icon: '🎯' },
      // Vendors
      { href: '/ops/vendors', label: 'Vendors', icon: '🏢' },
      { href: '/ops/vendors/scorecard', label: 'Vendor Scorecard', icon: '🏆' },
      // Receiving / Returns
      { href: '/ops/receiving', label: 'Receiving', icon: '📥' },
      { href: '/ops/returns', label: 'Returns', icon: '🔄' },
      // Supply Chain Overview
      { href: '/ops/supply-chain', label: 'Supply Chain Overview', icon: '🔗' },
    ],
  },
  // 5. FINANCE — Invoices, Payments, Collections, Reports, Accounting
  {
    label: 'FINANCE', id: 'finance',
    items: [
      { href: '/ops/finance', label: 'Financial Dashboard', icon: '💰' },
      { href: '/ops/finance/cash', label: 'Cash Command Center', icon: '💹' },
      { href: '/ops/finance/modeler', label: '$1M Scenario Modeler', icon: '🧮' },
      { href: '/ops/finance/ar', label: 'Accounts Receivable', icon: '📊' },
      { href: '/ops/finance/payments', label: 'Payment Ledger', icon: '💳' },
      { href: '/ops/finance/ap', label: 'Accounts Payable', icon: '📋' },
      { href: '/ops/finance/health', label: 'Company Health', icon: '❤️' },
      { href: '/ops/finance/bank', label: 'Bank & Credit Lines', icon: '🏦' },
      { href: '/ops/finance/optimization', label: 'Financial Optimizer', icon: '🎯' },
      { href: '/ops/collections', label: 'Collections Center', icon: '📞' },
      { href: '/ops/cash-flow-optimizer', label: 'AI Cash Flow Brain', icon: '💸' },
      { href: '/ops/accounting/journal-entries', label: 'Journal Entries', icon: '📒' },
      { href: '/ops/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: '📚' },
    ],
  },
  // 6. AI / BRAIN — Brain Insights, AI Insights, Predictive
  {
    label: 'AI / BRAIN', id: 'ai-brain',
    items: [
      { href: '/ops/brain-insights', label: 'Brain Insights', icon: '🧠' },
      { href: '/ops/ai/insights', label: 'AI Insights', icon: '💡' },
      { href: '/ops/ai/scans', label: 'NUC Scans', icon: '🔬' },
      { href: '/ops/ai/competitive', label: 'Competitive Intel', icon: '⚔️' },
      { href: '/ops/ai/health', label: 'Business Health', icon: '❤️' },
      { href: '/ops/ai/predictive', label: 'Predictive Analytics', icon: '🔮' },
      { href: '/ops/ai/scheduling', label: 'Schedule Optimizer', icon: '📅' },
      { href: '/ops/automations', label: 'Automations & Tasks', icon: '⚡' },
    ],
  },
  // 7. DEPARTMENT PORTALS — kept intact
  {
    label: 'DEPARTMENT PORTALS', id: 'portals',
    items: [
      { href: '/ops/portal', label: 'Portal Hub', icon: '🏢' },
      { href: '/ops/portal/pm', label: 'PM Portal', icon: '📋' },
      { href: '/ops/portal/pm/material', label: 'My Material Status', icon: '🎯' },
      { href: '/ops/portal/pm/briefing', label: 'Morning Briefing', icon: '☀️' },
      { href: '/ops/portal/pm/material-eta', label: 'Material ETA', icon: '📦' },
      { href: '/ops/portal/pm/scorecard', label: 'PM Scorecard', icon: '📈' },
      { href: '/ops/portal/pm/performance', label: 'PM Performance', icon: '📊' },
      { href: '/ops/portal/sales', label: 'Sales Portal', icon: '🎯' },
      { href: '/ops/portal/sales/briefing', label: 'Sales Morning Briefing', icon: '☀️' },
      { href: '/ops/portal/sales/scorecard', label: 'Sales Scorecard', icon: '📊' },
      { href: '/ops/portal/purchasing', label: 'Purchasing', icon: '🛒' },
      { href: '/ops/portal/purchasing/briefing', label: 'Purchasing Briefing', icon: '📋' },
      { href: '/ops/portal/warehouse', label: 'Warehouse', icon: '🏭' },
      { href: '/ops/portal/warehouse/daily-plan', label: 'Daily Plan (Standup)', icon: '📅' },
      { href: '/ops/portal/warehouse/picks', label: "Today's Picks", icon: '📋' },
      { href: '/ops/portal/warehouse/briefing', label: 'Shift Briefing', icon: '☀️' },
      { href: '/ops/portal/delivery', label: 'Delivery & Logistics', icon: '🚚' },
      { href: '/ops/portal/driver', label: 'Driver Portal (Mobile)', icon: '📱' },
      { href: '/ops/portal/dispatch', label: 'Dispatch (Live)', icon: '📍' },
      { href: '/ops/portal/installer', label: 'Installer Portal', icon: '👷' },
      { href: '/ops/portal/installer/briefing', label: 'Installer Briefing', icon: '☀️' },
      { href: '/ops/portal/installer/schedule', label: 'Installer Schedule', icon: '📅' },
      { href: '/ops/portal/accounting', label: 'Accounting', icon: '💰' },
      { href: '/ops/portal/accounting/briefing', label: 'Accounting Briefing', icon: '📋' },
      { href: '/ops/portal/estimator', label: 'Estimator Portal', icon: '📐' },
      { href: '/ops/portal/estimator/briefing', label: 'Estimator Briefing', icon: '📋' },
      { href: '/ops/portal/qc', label: 'QC Center', icon: '✅' },
      { href: '/ops/portal/qc/queue', label: 'Inspection Queue', icon: '📋' },
      { href: '/ops/portal/qc/trends', label: 'Quality Trends', icon: '📈' },
      { href: '/ops/portal/qc/rework', label: 'Rework Queue', icon: '🔧' },
    ],
  },
  // 8. SETTINGS / ADMIN — Staff, Settings, Audit, API Keys, Imports,
  //                       Integrations, Automations, System Health, Resources
  {
    label: 'SETTINGS / ADMIN', id: 'admin',
    items: [
      { href: '/ops/admin/system-health', label: 'System Health', icon: '❤️' },
      { href: '/ops/staff', label: 'Staff Management', icon: '👥' },
      { href: '/ops/admin/api-keys', label: 'API Keys', icon: '🔑' },
      { href: '/ops/locations', label: 'Locations', icon: '🏢' },
      { href: '/ops/delegations', label: 'Workload Delegation', icon: '🔄' },
      { href: '/ops/automations', label: 'Automations', icon: '⚡' },
      // Integrations
      { href: '/ops/integrations', label: 'Integration Hub', icon: '🔗' },
      { href: '/ops/sync-health', label: 'Sync Health', icon: '🩺' },
      { href: '/ops/integrations/buildertrend', label: 'BuilderTrend', icon: '🏗️' },
      { href: '/ops/integrations/supplier-pricing', label: 'Supplier Pricing', icon: '🌲' },
      { href: '/ops/integrations/routing-audit', label: 'Routing Audit', icon: '🔍' },
      { href: '/ops/imports', label: 'Data Imports', icon: '📥' },
      { href: '/ops/integrations', label: 'Integrations', icon: '🔗' },
      // Resources
      { href: '/ops/documents/vault', label: 'Document Vault', icon: '🗄️' },
      { href: '/ops/documents', label: 'Document Library', icon: '📁' },
      // Audit / Settings / Profile
      { href: '/ops/audit', label: 'Audit Log', icon: '📝' },
      { href: '/ops/settings', label: 'Settings', icon: '⚙️' },
      { href: '/ops/profile', label: 'My Profile', icon: '👤' },
    ],
  },
]

const ROLE_DISPLAY: Record<string, string> = {
  ADMIN: 'Admin', MANAGER: 'Manager', PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator', SALES_REP: 'Sales Rep', PURCHASING: 'Purchasing',
  WAREHOUSE_LEAD: 'Warehouse Lead', WAREHOUSE_TECH: 'Warehouse Tech',
  DRIVER: 'Driver', INSTALLER: 'Installer', QC_INSPECTOR: 'QC Inspector',
  ACCOUNTING: 'Accounting', VIEWER: 'Viewer',
}

interface StaffUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  roles: string[]
  department: string
  title: string | null
  portalOverrides?: PortalOverrides
}

// ── Collapsible Section ────────────────────────────────────────────────────

function SidebarSection({
  section,
  pathname,
  collapsed,
  onNavigate,
  badgeCounts,
}: {
  section: NavSection
  pathname: string
  collapsed: boolean
  onNavigate: () => void
  badgeCounts: Partial<Record<'inbox', number>>
}) {
  const hasActive = section.items.some((item) =>
    item.href === '/ops' ? pathname === '/ops' : pathname.startsWith(item.href)
  )
  const [open, setOpen] = useState(hasActive)

  return (
    <div className="mb-0.5">
      {!collapsed && (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold text-fg-subtle uppercase tracking-[0.18em] hover:text-fg-muted transition-colors bp-label"
        >
          <span>{section.label}</span>
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          />
        </button>
      )}
      {(open || collapsed) && (
        <div className={`${collapsed ? 'space-y-0.5 px-1.5' : 'space-y-px px-2'}`}>
          {section.items.map((item) => {
            const isActive =
              item.href === '/ops'
                ? pathname === '/ops'
                : pathname.startsWith(item.href)
            const IconComponent = ICON_MAP[item.icon] || BarChart3

            const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : undefined
            const showBadge = typeof badgeCount === 'number' && badgeCount > 0

            const linkContent = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150 group ${
                  isActive
                    ? 'bg-surface-elevated text-signal border-l-2 border-signal pl-[10px]'
                    : 'text-fg-subtle hover:text-fg hover:bg-white/[0.04] border-l-2 border-transparent'
                }`}
              >
                <IconComponent
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-signal' : 'text-fg-subtle group-hover:text-fg-muted'
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && showBadge && (
                  <Badge variant="danger" size="xs" className="ml-auto">
                    {badgeCount > 99 ? '99+' : String(badgeCount)}
                  </Badge>
                )}
                {collapsed && showBadge && (
                  <span
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-data-negative"
                    aria-hidden
                  />
                )}
              </Link>
            )

            return collapsed ? (
              <Tooltip key={item.href} content={item.label} side="right" delay={100}>
                {linkContent}
              </Tooltip>
            ) : (
              <div key={item.href}>{linkContent}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Layout ────────────────────────────────────────────────────────────

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [staff, setStaff] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const cmdMenu = useCommandMenu()

  const isAuthPage =
    pathname === '/ops/login' ||
    pathname === '/ops/forgot-password' ||
    pathname === '/ops/reset-password' ||
    pathname === '/ops/setup-account'

  // Close user menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    if (showUserMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showUserMenu])

  // Keyboard shortcuts:
  //   Cmd+B  — toggle sidebar
  //   Shift+T — toggle TaskPanel (dispatched as a custom event so TaskPanel
  //            stays self-contained and doesn't need to be lifted into layout state)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setCollapsed((prev) => !prev)
      }
      // Shift+T — only fire when not typing in an input/textarea/contenteditable
      if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          target?.isContentEditable
        ) {
          return
        }
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('toggle-task-panel'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Scroll-linked header shadow — listen on the scroll container, since
  // the page itself doesn't scroll (overflow-hidden on <main>).
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onScroll() {
      const y = el?.scrollTop ?? 0
      setHeaderScrolled(y > 20)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll() // sync initial state
    return () => el.removeEventListener('scroll', onScroll)
  }, [staff])

  const fetchSession = useCallback(async () => {
    if (isAuthPage) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/ops/auth/me')
      if (res.ok) {
        const data = await res.json()
        setStaff(data.staff)
      } else if (res.status === 401 || res.status === 403) {
        window.location.href = '/ops/login'
        return
      }
    } catch {
      window.location.href = '/ops/login'
    } finally {
      setLoading(false)
    }
  }, [isAuthPage])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  // Poll the inbox count for the sidebar badge — cheap call, refresh every 60s
  useEffect(() => {
    if (isAuthPage || !staff) return
    let cancelled = false
    async function loadInboxCount() {
      try {
        const res = await fetch('/api/ops/inbox/scoped?status=PENDING&limit=1', {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setInboxCount(data?.totalPending ?? 0)
      } catch {
        // ignore — badge simply won't show
      }
    }
    loadInboxCount()
    const t = setInterval(loadInboxCount, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [isAuthPage, staff])

  if (isAuthPage) return <>{children}</>

  const staffRoles = staff?.roles?.length
    ? (staff.roles as StaffRole[])
    : staff
      ? [staff.role as StaffRole]
      : []
  const staffOverrides = staff?.portalOverrides || null
  const visibleSections = staff
    ? NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          canAccessRoute(staffRoles, item.href, staffOverrides)
        ),
      })).filter((section) => section.items.length > 0)
    : []

  async function handleLogout() {
    await fetch('/api/ops/auth/logout', { method: 'POST' })
    window.location.href = '/ops/login'
  }

  return (
    <ThemeProvider>
      <div className="flex min-h-screen bg-canvas text-fg">
        {/* ── Top accent hairline (4-stop gradient) ───────────── */}
        <div className="fixed top-0 left-0 right-0 h-px z-[60]" style={{ background: 'linear-gradient(90deg, transparent, var(--c1), var(--c2), var(--c3), var(--c4), transparent)' }} />

        {/* ── Mobile overlay ─────────────────────────────────── */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden animate-[fadeIn_150ms_ease-out]"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ── Sidebar ────────────────────────────────────────── */}
        <aside
          className={`${
            collapsed ? 'lg:w-[4.5rem]' : 'lg:w-[16rem]'
          } fixed lg:static inset-y-0 left-0 z-50 w-[16rem] transition-[width,transform] duration-base ease-out flex flex-col border-r border-[rgba(198,162,78,0.06)] shadow-[1px_0_8px_rgba(5,13,22,0.15)] side-panel ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Sidebar header */}
          <div className="h-[3.25rem] px-3.5 flex items-center justify-between border-b border-border shrink-0">
            {!collapsed ? (
              <div className="flex items-center gap-2">
                <Image src="/icon-192.png" alt="Abel Lumber" width={26} height={26} className="rounded-md" />
                <div>
                  <p className="text-[13px] font-semibold text-fg leading-none tracking-tight">Aegis</p>
                  <p className="text-[10px] text-fg-subtle mt-0.5 font-mono">Abel Lumber · Ops</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex justify-center">
                <Image src="/icon-192.png" alt="Abel Lumber" width={26} height={26} className="rounded-md" />
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:flex p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-white/5 transition-colors"
              aria-label="Toggle sidebar"
            >
              {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>

          {/* User card */}
          {staff && (
            <div className={`border-b border-border shrink-0 ${collapsed ? 'px-2 py-3' : 'px-4 py-3'}`}>
              {collapsed ? (
                <Tooltip content={`${staff.firstName} ${staff.lastName}`} side="right">
                  <div className="flex justify-center">
                    <Avatar name={`${staff.firstName} ${staff.lastName}`} size="sm" status="online" />
                  </div>
                </Tooltip>
              ) : (
                <div className="flex items-center gap-3">
                  <Avatar name={`${staff.firstName} ${staff.lastName}`} size="md" status="online" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg truncate">
                      {staff.firstName} {staff.lastName}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {staffRoles.slice(0, 2).map((r) => (
                        <Badge key={r} variant="neutral" size="xs" className="!bg-surface-muted !text-fg-subtle">
                          {ROLE_DISPLAY[r] || r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-3 scrollbar-thin">
            {loading ? (
              <div className="px-4 py-8 space-y-3 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-3 rounded bg-surface-muted mx-2" style={{ width: `${60 + i * 5}%` }} />
                ))}
              </div>
            ) : (
              visibleSections.map((section) => (
                <SidebarSection
                  key={section.id}
                  section={section}
                  pathname={pathname}
                  collapsed={collapsed}
                  onNavigate={() => setMobileOpen(false)}
                  badgeCounts={{ inbox: inboxCount ?? undefined }}
                />
              ))
            )}
          </nav>

          {/* Sidebar footer */}
          <div className="p-3 border-t border-border shrink-0 space-y-1">
            {!collapsed ? (
              <>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-subtle hover:text-fg hover:bg-white/[0.04] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Builder View
                </Link>
                {staff && (
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-fg-subtle hover:text-data-negative hover:bg-data-negative-bg transition-colors w-full text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                )}
              </>
            ) : (
              <>
                <Tooltip content="Builder View" side="right">
                  <Link href="/dashboard" className="flex justify-center p-2 rounded-lg text-fg-subtle hover:text-fg hover:bg-white/5 transition-colors">
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                </Tooltip>
                {staff && (
                  <Tooltip content="Sign Out" side="right">
                    <button
                      onClick={handleLogout}
                      className="flex justify-center p-2 rounded-lg text-fg-subtle hover:text-data-negative hover:bg-data-negative-bg transition-colors w-full"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── Main content area ──────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <header
            className={`h-[3.25rem] border-b border-glass-border px-4 sm:px-6 flex items-center justify-between shrink-0 relative z-10 transition-shadow duration-200 ${
              headerScrolled ? 'shadow-md' : ''
            }`}
            style={{ background: 'var(--glass)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}
          >
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="lg:hidden p-2 -ml-2 rounded-md hover:bg-surface-muted transition-colors"
                aria-label="Toggle sidebar"
              >
                <Menu className="w-5 h-5 text-fg-muted" />
              </button>
              <h2 className="text-[13px] font-semibold text-fg tracking-tight">Aegis</h2>
              <span className="text-[11px] text-fg-subtle hidden sm:inline font-mono">Abel Operations</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Command palette trigger */}
              <button
                onClick={() => cmdMenu.setOpen(true)}
                className="hidden sm:flex items-center gap-2 h-8 px-2.5 pr-2 border border-border rounded-md bg-surface-muted text-fg-muted hover:text-fg hover:border-border-strong transition-colors text-xs"
                aria-label="Open command palette"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search…</span>
                <span className="kbd ml-2">⌘K</span>
              </button>

              <GlobalSearch />

              {/* Sync chip — live/catching-up/offline with dropdown */}
              <SyncChip className="hidden sm:inline-flex" />

              <NotificationBell />

              {/* Date */}
              <span className="text-[11px] hidden md:inline text-fg-subtle font-mono tabular-nums ml-1">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
              </span>

              {/* Live clock — America/Chicago */}
              <div className="hidden md:flex items-center ml-1">
                <LiveClock />
              </div>

              {/* Density toggle — persists to localStorage + Staff.preferences */}
              <div className="hidden md:flex items-center ml-1">
                <DensityToggle role={staff?.role} compactLabels />
              </div>

              {/* Separator */}
              <div className="hidden sm:block w-px h-5 bg-border mx-1" />

              {/* User avatar menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-full"
                  aria-label="User menu"
                >
                  <Avatar
                    name={staff ? `${staff.firstName} ${staff.lastName}` : ''}
                    size="sm"
                  />
                </button>

                {/* Dropdown */}
                {showUserMenu && staff && (
                  <div className="absolute right-0 top-11 w-64 rounded-xl shadow-glass glass-card z-50 animate-[slideDown_150ms_ease-out] overflow-hidden bp-registration">
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-sm font-bold text-fg">
                        {staff.firstName} {staff.lastName}
                      </p>
                      <p className="text-xs text-fg-muted mt-0.5">{staff.email}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {staffRoles.map((r) => (
                          <Badge key={r} variant="brand" size="xs">{ROLE_DISPLAY[r] || r}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="py-1">
                      <Link
                        href="/ops/profile"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-fg hover:bg-surface-muted transition-colors"
                      >
                        <User className="w-4 h-4 text-fg-subtle" />
                        My Profile
                      </Link>
                      <Link
                        href="/ops/settings"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-fg hover:bg-surface-muted transition-colors"
                      >
                        <Settings className="w-4 h-4 text-fg-subtle" />
                        Settings
                      </Link>
                    </div>
                    <div className="border-t border-border py-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-data-negative hover:bg-data-negative-bg transition-colors w-full text-left"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Live data indicator — pulses when any tracked topic publishes */}
          <LivePulse />

          {/* Content area */}
          <div ref={scrollContainerRef} className="flex-1 overflow-auto bg-canvas relative">
            <AegisBackground variant="full" orbCount={3} doorBlueprint />
            <PortalBackground portal="ops" />
            <PageBackground section={getSectionForPath(pathname)} />
            {/* Tier 6.1 — header gradient strip (200px tall, fades to transparent) */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 right-0 h-[200px] z-0"
              style={{ background: 'linear-gradient(to bottom, rgba(10, 26, 40, 0.5), transparent)' }}
            />
            {/* Tier 7.1 — page transition. key={pathname} re-fires animate-enter on every route change. */}
            <div key={pathname} className="relative z-[1] p-5 lg:p-7 max-w-7xl mx-auto animate-enter">
              {children}
            </div>
          </div>

          {/* System status bar — live state, bottom of shell */}
          <StatusBarWithLive />

          {/* SystemPulse — mounted hidden so its alert/readiness polling runs.
              Drives `abel:alerts-count` listeners and keeps /api/health/ready warm. */}
          <div className="hidden" aria-hidden="true">
            <SystemPulse />
          </div>
        </main>

        {/* Command palette (⌘K) */}
        <CommandMenu open={cmdMenu.open} onClose={() => cmdMenu.setOpen(false)} />

        {/* Keyboard shortcuts cheat sheet (?) */}
        <ShortcutsOverlay />

        {/* AI Copilot */}
        {staff && <AICopilot />}

        {/* Global recent-activity drawer (toggle with 'A') */}
        <RecentActivityDrawer />

        {/* Help panel — floating ? button on every page */}
        <HelpPanel />

        {/* Task panel — floating checklist FAB (Shift+T) */}
        {staff && <TaskPanel staffId={staff.id} staffRole={staff.role} />}
      </div>
    </ThemeProvider>
  )
}

// ── Live-data pulse: 4px bar that fires whenever any topic publishes ───
function LivePulse() {
  const tick = useLiveTick(null)
  return <LiveDataIndicator trigger={tick} />
}

// ── StatusBar wrapper that adds LiveClock + HealthChip ─────────────────
function StatusBarWithLive() {
  return (
    <div className="flex items-center border-t border-border bg-surface">
      <div className="flex-1">
        <StatusBar deployTag="go-live-2026-04-13" lastSyncAt={null} alertCount={0} />
      </div>
      <div className="flex items-center gap-3 pr-4 h-7 text-[11px]">
        <HealthChip />
        <span className="h-3 w-px bg-border" />
        <LiveClock />
      </div>
    </div>
  )
}
