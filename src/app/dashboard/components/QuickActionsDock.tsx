'use client'

import Link from 'next/link'
import {
  Package,
  FileText,
  DollarSign,
  Truck,
  MessageSquare,
  Book,
  Shield,
  BarChart3,
  Settings,
} from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

interface QuickAction {
  href: string
  icon: React.ReactNode
  label: string
  color: string
  hoverBg: string
}

const ACTIONS: QuickAction[] = [
  {
    href: '/dashboard/orders',
    icon: <Package className="w-5 h-5" />,
    label: 'Orders',
    color: 'text-signal dark:text-signal-hover',
    hoverBg: 'group-hover:bg-amber-50 dark:group-hover:bg-amber-950/20',
  },
  {
    href: '/dashboard/invoices',
    icon: <FileText className="w-5 h-5" />,
    label: 'Invoices',
    color: 'text-blue-600 dark:text-blue-400',
    hoverBg: 'group-hover:bg-blue-50 dark:group-hover:bg-blue-950/20',
  },
  {
    href: '/dashboard/payments',
    icon: <DollarSign className="w-5 h-5" />,
    label: 'Payments',
    color: 'text-emerald-600 dark:text-emerald-400',
    hoverBg: 'group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/20',
  },
  {
    href: '/dashboard/deliveries',
    icon: <Truck className="w-5 h-5" />,
    label: 'Deliveries',
    color: 'text-cyan-600 dark:text-cyan-400',
    hoverBg: 'group-hover:bg-cyan-50 dark:group-hover:bg-cyan-950/20',
  },
  {
    href: '/dashboard/chat',
    icon: <MessageSquare className="w-5 h-5" />,
    label: 'Chat',
    color: 'text-violet-600 dark:text-violet-400',
    hoverBg: 'group-hover:bg-violet-50 dark:group-hover:bg-violet-950/20',
  },
  {
    href: '/catalog',
    icon: <Book className="w-5 h-5" />,
    label: 'Catalog',
    color: 'text-brand dark:text-brand-hover',
    hoverBg: 'group-hover:bg-brand/5 dark:group-hover:bg-brand/10',
  },
  {
    href: '/dashboard/warranty',
    icon: <Shield className="w-5 h-5" />,
    label: 'Warranty',
    color: 'text-rose-600 dark:text-rose-400',
    hoverBg: 'group-hover:bg-rose-50 dark:group-hover:bg-rose-950/20',
  },
  {
    href: '/dashboard/analytics',
    icon: <BarChart3 className="w-5 h-5" />,
    label: 'Analytics',
    color: 'text-indigo-600 dark:text-indigo-400',
    hoverBg: 'group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/20',
  },
  {
    href: '/dashboard/settings',
    icon: <Settings className="w-5 h-5" />,
    label: 'Settings',
    color: 'text-fg-muted',
    hoverBg: 'group-hover:bg-surface-muted dark:group-hover:bg-gray-800',
  },
]

export default function QuickActionsDock() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
      {ACTIONS.map((action, idx) => (
        <Tooltip key={action.href} content={action.label} side="bottom" delay={300}>
          <Link
            href={action.href}
            className="group flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl bg-surface border border-border transition-all duration-200 hover:border-border-strong dark:hover:border-gray-700 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none animate-enter"
            style={{ animationDelay: `${idx * 30}ms` }}
            aria-label={action.label}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${action.hoverBg} ${action.color}`}
            >
              {action.icon}
            </div>
            <span className="text-[11px] font-semibold text-fg-muted group-hover:text-fg dark:group-hover:text-white transition-colors text-center leading-tight">
              {action.label}
            </span>
          </Link>
        </Tooltip>
      ))}
    </div>
  )
}
