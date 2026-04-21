'use client'

import Link from 'next/link'
import { Mail, Phone, MessageSquare, Award, FileText, ArrowRight } from 'lucide-react'
import Card from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

interface AccountRep {
  firstName: string
  lastName: string
  email: string
  phone: string
  title?: string
}

interface AccountSidebarProps {
  accountRep?: AccountRep | null
  paymentSummary?: {
    openInvoiceCount: number
    totalOutstanding: number
    overdueAmount: number
    paidLast30Days: number
  }
  lifetimeStats?: {
    totalOrders: number
    lifetimeValue: number
    last30DaysValue: number
    status: string
  }
  recentPayments?: Array<{
    id: string
    amount: number
    method: string
    invoiceNumber: string
    receivedAt: string
  }>
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatCurrencyFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function AccountSidebar({
  accountRep,
  paymentSummary,
  lifetimeStats,
  recentPayments,
}: AccountSidebarProps) {
  return (
    <div className="space-y-5">
      {/* ── Account Rep ──────────────────────────────────────── */}
      {accountRep && (
        <Card variant="default" padding="md" rounded="2xl" className="animate-enter animate-enter-delay-1">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded flex items-center justify-center text-signal">
              <MessageSquare className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Your Account Manager</h3>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <Avatar
              name={`${accountRep.firstName} ${accountRep.lastName}`}
              size="lg"
              status="online"
            />
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                {accountRep.firstName} {accountRep.lastName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {accountRep.title || 'Account Manager'}
              </p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {accountRep.email && (
              <a
                href={`mailto:${accountRep.email}`}
                className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 hover:text-brand dark:hover:text-brand-hover transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                {accountRep.email}
              </a>
            )}
            {accountRep.phone && (
              <a
                href={`tel:${accountRep.phone}`}
                className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 hover:text-brand dark:hover:text-brand-hover transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                {accountRep.phone}
              </a>
            )}
          </div>

          <Link href="/dashboard/messages">
            <Button
              variant="primary"
              size="sm"
              fullWidth
              icon={<MessageSquare className="w-4 h-4" />}
            >
              Send Message
            </Button>
          </Link>
        </Card>
      )}

      {/* ── Payment Summary ──────────────────────────────────── */}
      {paymentSummary && (
        <Card variant="default" padding="md" rounded="2xl" className="animate-enter animate-enter-delay-2">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-signal" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Payment Summary</h3>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Open Invoices</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {paymentSummary.openInvoiceCount}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Total Outstanding</span>
              <span className="text-sm font-bold text-signal">
                {formatCurrencyFull(paymentSummary.totalOutstanding)}
              </span>
            </div>
            {paymentSummary.overdueAmount > 0 && (
              <div className="flex justify-between items-center pt-2.5 border-t border-gray-100 dark:border-gray-800">
                <span className="text-xs text-danger-600 dark:text-danger-400 font-medium">Overdue</span>
                <span className="text-sm font-bold text-danger-600 dark:text-danger-400">
                  {formatCurrencyFull(paymentSummary.overdueAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2.5 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400">Paid (Last 30 days)</span>
              <span className="text-sm font-bold text-success-600 dark:text-success-400">
                {formatCurrencyFull(paymentSummary.paidLast30Days)}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* ── Recent Payments ──────────────────────────────────── */}
      {recentPayments && recentPayments.length > 0 && (
        <Card variant="default" padding="md" rounded="2xl" className="animate-enter animate-enter-delay-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Recent Payments</h3>
          <div className="space-y-2.5">
            {recentPayments.slice(0, 3).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
              >
                <div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{p.invoiceNumber}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {p.method} &middot;{' '}
                    {new Date(p.receivedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <span className="text-xs font-bold text-success-600 dark:text-success-400">
                  -{formatCurrencyFull(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Lifetime Stats ──────────────────────────────────── */}
      {lifetimeStats && (
        <Card variant="default" padding="md" rounded="2xl" className="animate-enter animate-enter-delay-4">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-4 h-4 text-signal" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Lifetime Stats</h3>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Total Orders</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{lifetimeStats.totalOrders}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Lifetime Value</span>
              <span className="text-sm font-bold text-signal">{formatCurrency(lifetimeStats.lifetimeValue)}</span>
            </div>
            <div className="flex justify-between items-center pt-2.5 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400">Last 30 Days</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {formatCurrency(lifetimeStats.last30DaysValue)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Account Status</span>
              <Badge variant="success" size="sm" dot>{lifetimeStats.status}</Badge>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
