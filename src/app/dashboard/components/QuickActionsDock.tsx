'use client'

import Link from 'next/link'
import { Package, FileText, DollarSign, Truck, MessageSquare, Book, Shield, BarChart3, Settings, Home } from 'lucide-react'

interface QuickAction {
  href: string
  icon: React.ReactNode
  label: string
}

const ACTIONS: QuickAction[] = [
  { href: '/dashboard/orders', icon: <Package className="w-5 h-5" />, label: 'Orders' },
  { href: '/dashboard/invoices', icon: <FileText className="w-5 h-5" />, label: 'Invoices' },
  { href: '/dashboard/payments', icon: <DollarSign className="w-5 h-5" />, label: 'Payments' },
  { href: '/dashboard/deliveries', icon: <Truck className="w-5 h-5" />, label: 'Deliveries' },
  { href: '/dashboard/messages', icon: <MessageSquare className="w-5 h-5" />, label: 'Messages' },
  { href: '/catalog', icon: <Book className="w-5 h-5" />, label: 'Catalog' },
  { href: '/dashboard/warranty', icon: <Shield className="w-5 h-5" />, label: 'Warranty' },
  { href: '/dashboard/analytics', icon: <BarChart3 className="w-5 h-5" />, label: 'Analytics' },
  { href: '/dashboard/settings', icon: <Settings className="w-5 h-5" />, label: 'Settings' },
]

export default function QuickActionsDock() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
      {ACTIONS.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex flex-col items-center justify-center p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:shadow-sm hover:-translate-y-1"
          aria-label={action.label}
        >
          <div className="text-slate-600 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-1.5">
            {action.icon}
          </div>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-center">
            {action.label}
          </span>
        </Link>
      ))}
    </div>
  )
}
