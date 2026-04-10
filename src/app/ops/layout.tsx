'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { canAccessRoute, type PortalOverrides } from '@/lib/permissions'
import { NotificationBell } from './components/NotificationBell'
import AICopilot from './components/AICopilot'
import ThemeProvider from './components/ThemeProvider'
import type { StaffRole } from '@/lib/permissions'
import {
  BarChart3, Briefcase, Truck, Settings, TrendingUp, Wrench, Calendar, HardHat, Target, FileText,
  File, ClipboardList, DollarSign, Brain, Mail, Megaphone, Phone, Building2, Inbox, Building,
  Home, CircleDollarSign, ShoppingCart, RefreshCw, Search, Ruler, Package, Shield, ScrollText,
  Factory, Cog, CheckCircle, Banknote, Printer, Smartphone, Scale, Bot, Download, Map,
  Heart, Sparkles, Zap, Handshake, Link2, TreePine, Archive, FolderOpen, Users, User,
  MessageSquare, MailOpen, Bell, Wallet, Landmark, Sun, ChevronLeft, ChevronRight,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// Navigation sections — each item has an href, label, icon, and
// optional minRole array (if omitted, all authenticated staff can see it)
// ──────────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: string // mapped to ICON_MAP
}

interface NavSection {
  label: string
  id: string
  items: NavItem[]
}

// Icon mapping from emoji strings to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  '📊': BarChart3,
  '👔': Briefcase,
  '🚚': Truck,
  '⚙️': Settings,
  '📈': TrendingUp,
  '🔧': Wrench,
  '📅': Calendar,
  '👷': HardHat,
  '🎯': Target,
  '📝': FileText,
  '📄': File,
  '📋': ClipboardList,
  '💰': DollarSign,
  '🧠': Brain,
  '📧': Mail,
  '📣': Megaphone,
  '📞': Phone,
  '🏗️': Building2,
  '📨': Inbox,
  '🏢': Building,
  '🏘️': Home,
  '💲': CircleDollarSign,
  '🛒': ShoppingCart,
  '🔄': RefreshCw,
  '🔍': Search,
  '📐': Ruler,
  '📦': Package,
  '🛡️': Shield,
  '📜': ScrollText,
  '🏭': Factory,
  '🔩': Cog,
  '✅': CheckCircle,
  '💵': Banknote,
  '🖨️': Printer,
  '📱': Smartphone,
  '⚖️': Scale,
  '🤖': Bot,
  '📥': Download,
  '🗺️': Map,
  '❤️': Heart,
  '🔮': Sparkles,
  '⚡': Zap,
  '🤝': Handshake,
  '🔗': Link2,
  '🌲': TreePine,
  '🗄️': Archive,
  '📁': FolderOpen,
  '👥': Users,
  '👤': User,
  '💬': MessageSquare,
  '📩': MailOpen,
  '🔔': Bell,
  '💸': Wallet,
  '🏦': Landmark,
  '☀️': Sun,
  '📍': Home, // fallback for pin icon
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    id: 'overview',
    items: [
      { href: '/ops', label: 'Dashboard', icon: '📊' },
    ],
  },
  {
    label: 'Executive',
    id: 'executive',
    items: [
      { href: '/ops/executive', label: 'CEO Dashboard', icon: '👔' },
      { href: '/ops/kpis', label: 'KPIs', icon: '📊' },
      { href: '/ops/reports', label: 'Reports & Analytics', icon: '📊' },
      { href: '/ops/reports/shipping-forecast', label: 'Shipping Forecast', icon: '🚚' },
      { href: '/ops/executive/operations', label: 'Operations', icon: '⚙️' },
      { href: '/ops/finance', label: 'Financial', icon: '📈' },
    ],
  },
  {
    label: 'Jobs & Projects',
    id: 'jobs',
    items: [
      { href: '/ops/jobs', label: 'Job Pipeline', icon: '🔧' },
      { href: '/ops/schedule', label: 'Schedule & Dispatch', icon: '📅' },
      { href: '/ops/crews', label: 'Crews', icon: '👷' },
      { href: '/ops/inspections', label: 'Inspections', icon: '✅' },
      { href: '/ops/lien-releases', label: 'Lien Releases', icon: '📜' },
    ],
  },
  {
    label: 'Sales Pipeline',
    id: 'sales',
    items: [
      { href: '/ops/sales', label: 'Sales Dashboard', icon: '🎯' },
      { href: '/ops/sales/reports', label: 'Sales Reports', icon: '📊' },
      { href: '/ops/sales/analytics', label: 'Sales Analytics', icon: '📈' },
      { href: '/ops/sales/contracts', label: 'Contracts', icon: '📝' },
      { href: '/ops/sales/documents', label: 'Document Requests', icon: '📄' },
      { href: '/ops/quote-requests', label: 'Quote Requests', icon: '📋' },
      { href: '/ops/pricing', label: 'Pricing Engine', icon: '💰' },
      { href: '/ops/sales/intelligence', label: 'Sales Intelligence', icon: '🧠' },
      { href: '/ops/sales/command-center', label: 'Sales Command Center', icon: '🎯' },
      { href: '/ops/sales/outreach', label: 'Outreach Sequences', icon: '📧' },
    ],
  },
  {
    label: 'Growth Engine',
    id: 'growth',
    items: [
      { href: '/ops/growth/leads', label: 'Lead Scoring & CLV', icon: '🎯' },
      { href: '/ops/growth/permits', label: 'Permit Pipeline', icon: '🗺️' },
      { href: '/ops/marketing/campaigns', label: 'Marketing Automation', icon: '📣' },
      { href: '/ops/outreach/tracker', label: 'Cold Outreach', icon: '📞' },
      { href: '/ops/revenue-intelligence', label: 'AI Revenue Machine', icon: '💰' },
      { href: '/ops/customer-catalog', label: 'Customer Catalog', icon: '🛒' },
    ],
  },
  {
    label: 'Accounts & Orders',
    id: 'accounts',
    items: [
      { href: '/ops/accounts', label: 'Builder Accounts', icon: '🏗️' },
      { href: '/ops/accounts/applications', label: 'Builder Applications', icon: '📨' },
      { href: '/ops/organizations', label: 'Organizations', icon: '🏢' },
      { href: '/ops/communities', label: 'Communities', icon: '🏘️' },
      { href: '/ops/quotes', label: 'Quotes', icon: '💲' },
      { href: '/ops/orders', label: 'Orders', icon: '📄' },
      { href: '/ops/orders/ai-processing', label: 'AI Order Center', icon: '🤖' },
      { href: '/ops/quotes/conversion', label: 'Quote Conversion', icon: '🔄' },
      { href: '/ops/takeoff-inquiries', label: 'Takeoff Inquiries', icon: '📨' },
      { href: '/ops/takeoff-review', label: 'Takeoff Review', icon: '🔍' },
      { href: '/ops/floor-plans', label: 'Floor Plans', icon: '📐' },
      { href: '/ops/products', label: 'Product Catalog', icon: '📦' },
      { href: '/ops/catalog', label: 'Categories & Suppliers', icon: '🏷️' },
    ],
  },
  {
    label: 'Warranty',
    id: 'warranty',
    items: [
      { href: '/ops/warranty', label: 'Warranty Claims', icon: '🛡️' },
      { href: '/ops/warranty/policies', label: 'Warranty Policies', icon: '📜' },
    ],
  },
  {
    label: 'Manufacturing',
    id: 'manufacturing',
    items: [
      { href: '/ops/manufacturing', label: 'Manufacturing Dashboard', icon: '🏭' },
      { href: '/ops/manufacturing/build-sheet', label: 'Build Sheet', icon: '📝' },
      { href: '/ops/manufacturing/bom', label: 'Bill of Materials', icon: '🔩' },
      { href: '/ops/manufacturing/picks', label: 'Pick Lists', icon: '📋' },
      { href: '/ops/manufacturing/qc', label: 'Quality Control', icon: '✅' },
      { href: '/ops/manufacturing/staging', label: 'Staging', icon: '📦' },
      { href: '/ops/manufacturing/labor-costs', label: 'Labor & Overhead', icon: '💵' },
      { href: '/ops/manufacturing/job-packet', label: 'Print Job Packet', icon: '🖨️' },
      { href: '/ops/warehouse/pick-scanner', label: 'Pick Scanner', icon: '📱' },
    ],
  },
  {
    label: 'Warehouse & NFC',
    id: 'warehouse-nfc',
    items: [
      { href: '/ops/warehouse/bays', label: 'Bay Map', icon: '🏭' },
      { href: '/ops/warehouse/doors', label: 'Door Registry', icon: '📱' },
    ],
  },
  {
    label: 'Supply Chain',
    id: 'supply-chain',
    items: [
      { href: '/ops/inventory', label: 'Inventory', icon: '📦' },
      { href: '/ops/inventory/intelligence', label: 'Inventory Intelligence', icon: '🧠' },
      { href: '/ops/inventory/allocations', label: 'Allocations', icon: '📍' },
      { href: '/ops/purchasing', label: 'Purchase Orders', icon: '🛒' },
      { href: '/ops/purchasing/optimize', label: 'Purchasing Optimizer', icon: '⚖️' },
      { href: '/ops/procurement-intelligence', label: 'AI Procurement Brain', icon: '🤖' },
      { href: '/ops/vendors', label: 'Vendors', icon: '🏢' },
      { href: '/ops/receiving', label: 'Receiving', icon: '📥' },
      { href: '/ops/returns', label: 'Returns', icon: '🔄' },
      { href: '/ops/delivery/route-optimizer', label: 'Route Optimizer', icon: '🗺️' },
      { href: '/ops/delivery/optimize', label: 'Delivery Optimizer', icon: '🚚' },
    ],
  },
  {
    label: 'Finance',
    id: 'finance',
    items: [
      { href: '/ops/finance', label: 'Financial Dashboard', icon: '💰' },
      { href: '/ops/finance/ar', label: 'Accounts Receivable', icon: '📊' },
      { href: '/ops/finance/ap', label: 'Accounts Payable', icon: '📋' },
      { href: '/ops/finance/health', label: 'Company Health', icon: '❤️' },
      { href: '/ops/finance/bank', label: 'Bank & Credit Lines', icon: '🏦' },
      { href: '/ops/finance/optimization', label: 'Financial Optimizer', icon: '🎯' },
      { href: '/ops/collections', label: 'Collections Center', icon: '📞' },
      { href: '/ops/cash-flow-optimizer', label: 'AI Cash Flow Brain', icon: '💸' },
    ],
  },
  {
    label: 'Communication',
    id: 'communication',
    items: [
      { href: '/ops/agent', label: 'AI Agent Dashboard', icon: '🤖' },
      { href: '/ops/messages', label: 'Messages', icon: '💬' },
      { href: '/ops/builder-messages', label: 'Builder Inbox', icon: '📩' },
      { href: '/ops/communication-log', label: 'Communication Log', icon: '📧' },
      { href: '/ops/notifications', label: 'Notifications', icon: '🔔' },
    ],
  },
  {
    label: 'AI Operations Brain',
    id: 'ai-brain',
    items: [
      { href: '/ops/ai/health', label: 'Business Health', icon: '❤️' },
      { href: '/ops/ai/predictive', label: 'Predictive Analytics', icon: '🔮' },
      { href: '/ops/ai/scheduling', label: 'Schedule Optimizer', icon: '📅' },
      { href: '/ops/automations', label: 'Automations & Tasks', icon: '⚡' },
    ],
  },
  {
    label: 'Customer Value',
    id: 'customer-value',
    items: [
      { href: '/ops/portal/builder-intel', label: 'Builder Intelligence', icon: '🔍' },
      { href: '/ops/warranty/automation', label: 'Warranty Automation', icon: '🛡️' },
      { href: '/ops/accounts/proactive', label: 'Proactive Accounts', icon: '🤝' },
      { href: '/ops/trades', label: 'Trade Finder', icon: '🤝' },
    ],
  },
  {
    label: 'Integrations',
    id: 'integrations',
    items: [
      { href: '/ops/integrations', label: 'Integration Hub', icon: '🔗' },
      { href: '/ops/integrations/quickbooks', label: 'QuickBooks Desktop', icon: '💰' },
      { href: '/ops/integrations/buildertrend', label: 'BuilderTrend', icon: '🏗️' },
      { href: '/ops/integrations/supplier-pricing', label: 'Supplier Pricing', icon: '🌲' },
      { href: '/ops/integrations/routing-audit', label: 'Routing Audit', icon: '🔍' },
      { href: '/ops/imports', label: 'Data Imports', icon: '📥' },
    ],
  },
  {
    label: 'Department Portals',
    id: 'portals',
    items: [
      { href: '/ops/portal', label: 'Portal Hub', icon: '🏢' },
      { href: '/ops/portal/pm', label: 'PM Portal', icon: '📋' },
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
      { href: '/ops/portal/warehouse/briefing', label: 'Shift Briefing', icon: '☀️' },
      { href: '/ops/portal/delivery', label: 'Delivery & Logistics', icon: '🚚' },
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
  {
    label: 'Resources',
    id: 'resources',
    items: [
      { href: '/ops/documents/vault', label: 'Document Vault', icon: '🗄️' },
      { href: '/ops/documents', label: 'Document Library', icon: '📁' },
    ],
  },
  {
    label: 'Admin',
    id: 'admin',
    items: [
      { href: '/ops/staff', label: 'Staff Management', icon: '👥' },
      { href: '/ops/locations', label: 'Locations', icon: '🏢' },
      { href: '/ops/delegations', label: 'Workload Delegation', icon: '🔄' },
      { href: '/ops/audit', label: 'Audit Log', icon: '📝' },
      { href: '/ops/settings', label: 'Settings', icon: '⚙️' },
      { href: '/ops/profile', label: 'My Profile', icon: '👤' },
    ],
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Role labels for display
// ──────────────────────────────────────────────────────────────────────────
const ROLE_DISPLAY: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator',
  SALES_REP: 'Sales Rep',
  PURCHASING: 'Purchasing',
  WAREHOUSE_LEAD: 'Warehouse Lead',
  WAREHOUSE_TECH: 'Warehouse Tech',
  DRIVER: 'Driver',
  INSTALLER: 'Installer',
  QC_INSPECTOR: 'QC Inspector',
  ACCOUNTING: 'Accounting',
  VIEWER: 'Viewer',
}

interface StaffUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string         // Primary role (backward compat)
  roles: string[]      // All assigned roles (multi-role)
  department: string
  title: string | null
  portalOverrides?: PortalOverrides
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [staff, setStaff] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUserMenu, setShowUserMenu] = useState(false)

  // Don't run auth check on auth pages (login, forgot-password, reset-password)
  const isAuthPage = pathname === '/ops/login' || pathname === '/ops/forgot-password' || pathname === '/ops/reset-password'
  const isLoginPage = isAuthPage

  const fetchSession = useCallback(async () => {
    if (isLoginPage) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/ops/auth/me')
      if (res.ok) {
        const data = await res.json()
        setStaff(data.staff)
      } else if (res.status === 401 || res.status === 403) {
        // Not authenticated or not authorized — redirect to login or access denied
        window.location.href = '/ops/login'
        return
      }
    } catch {
      // Session check failed — redirect to login
      window.location.href = '/ops/login'
    } finally {
      setLoading(false)
    }
  }, [isLoginPage])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  // Login page gets its own full-screen layout (no sidebar)
  if (isLoginPage) {
    return <>{children}</>
  }

  // Filter sidebar sections based on ALL staff roles + portal overrides (multi-role: union of access)
  const staffRoles = staff?.roles?.length ? staff.roles as StaffRole[] : (staff ? [staff.role as StaffRole] : [])
  const staffOverrides = staff?.portalOverrides || null
  const visibleSections = staff
    ? NAV_SECTIONS.map((section: NavSection) => ({
        ...section,
        items: section.items.filter((item: NavItem) =>
          canAccessRoute(staffRoles, item.href, staffOverrides)
        ),
      })).filter((section: NavSection) => section.items.length > 0)
    : []

  const initials = staff
    ? `${staff.firstName[0]}${staff.lastName[0]}`.toUpperCase()
    : '...'

  async function handleLogout() {
    await fetch('/api/ops/auth/logout', { method: 'POST' })
    window.location.href = '/ops/login'
  }

  return (
    <ThemeProvider>
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--bg-primary, #f8f9fa)', color: 'var(--text-primary, #1a1a2e)' }}>
      {/* Top accent line */}
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 z-50" />
      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${
          collapsed ? 'lg:w-16' : 'lg:w-64'
        } fixed lg:static inset-y-0 left-0 z-50 w-64 text-white transition-all duration-200 flex flex-col border-r border-gray-800 bg-gray-900 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          {!collapsed && (
            <div className="flex flex-col gap-1">
              <Image
                src="/images/logos/abel-logo.png"
                alt="Abel Logo"
                width={100}
                height={32}
                className="h-8 w-auto"
              />
              <p className="text-xs text-gray-500">Operations Platform</p>
            </div>
          )}
          {collapsed && (
            <div className="flex-1 flex justify-center">
              <Image
                src="/images/logos/abel-logo.png"
                alt="Abel Logo"
                width={80}
                height={24}
                className="h-6 w-auto"
              />
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Logged-in user card */}
        {!collapsed && staff && (
          <div className="px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {staff.firstName} {staff.lastName}
                </p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {staffRoles.map((r: string) => (
                    <span key={r} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                      {ROLE_DISPLAY[r] || r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation — role-filtered */}
        <nav className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-gray-500">Loading...</p>
            </div>
          ) : (
            visibleSections.map((section: NavSection) => (
              <div key={section.id} className="mb-4">
                {!collapsed && (
                  <div className="px-4 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                    {section.label}
                  </div>
                )}
                {section.items.map((item: NavItem) => {
                  const isActive =
                    item.href === '/ops'
                      ? pathname === '/ops'
                      : pathname.startsWith(item.href)
                  const IconComponent = ICON_MAP[item.icon] || BarChart3
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-amber-500/10 text-amber-400 border-l-2 border-amber-400'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }`}
                    >
                      <IconComponent className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  )
                })}
              </div>
            ))
          )}
        </nav>

        {/* Footer with logout */}
        <div className="p-4 border-t border-gray-800">
          {!collapsed && (
            <div className="space-y-2">
              {staff && (
                <button
                  onClick={handleLogout}
                  className="block w-full text-left text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Sign Out
                </button>
              )}
              <Link
                href="/dashboard"
                className="block text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Builder View
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg-primary, #ffffff)' }}>
        {/* Top bar */}
        <header className="border-b px-4 sm:px-6 py-4 flex items-center justify-between" style={{ borderColor: 'var(--border-color, #e5e7eb)', backgroundColor: 'var(--bg-secondary, #f8f9fa)' }}>
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-1.5 rounded-lg transition"
              style={{ color: 'var(--text-secondary, #6b7280)' }}
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary, #1a1a2e)' }}>
              Abel Lumber Operations
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-secondary, #6b7280)' }}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-8 h-8 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center font-bold hover:bg-amber-400 transition-colors"
              >
                {initials}
              </button>
              {showUserMenu && staff && (
                <div className="absolute right-0 top-10 w-56 rounded-lg shadow-xl py-2 z-50" style={{ backgroundColor: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e5e7eb)' }}>
                  <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary, #1a1a2e)' }}>
                      {staff.firstName} {staff.lastName}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary, #6b7280)' }}>{staff.email}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {staffRoles.map((r: string) => (
                        <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--bg-secondary, #f8f9fa)', color: 'var(--accent-color, #E67E22)' }}>
                          {ROLE_DISPLAY[r] || r}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary, #6b7280)' }}>
                      {staff.department}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-100 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="p-6 lg:p-8" style={{ backgroundColor: 'var(--bg-primary, #ffffff)' }}>{children}</div>
      </main>

      {/* AI Co-pilot — floating chat available on every ops page */}
      {staff && <AICopilot />}
    </div>
    </ThemeProvider>
  )
}
