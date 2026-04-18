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
    color: 'text-amber-600 dark:text-amber-400',
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
    color: 'text-abel-navy dark:text-abel-navy-light',
    hoverBg: 'group-hover:bg-abel-navy/5 dark:group-hover:bg-abel-navy/10',
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
    color: 'text-gray-600 dark:text-gray-400',
    hoverBg: 'group-hover:bg-gray-50 dark:group-hover:bg-gray-800',
  },
]

export default function QuickActionsDock() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
      {ACTIONS.map((action, idx) => (
        <Tooltip key={action.href} content={action.label} side="bottom" delay={300}>
          <Link
            href={action.href}
            className="group flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none animate-enter"
            style={{ animationDelay: `${idx * 30}ms` }}
            aria-label={action.label}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${action.hoverBg} ${action.color}`}
            >
              {action.icon}
            </div>
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors text-center leading-tight">
              {action.label}
            </span>
          </Link>
        </Tooltip>
      ))}
    </div>
  )
}
