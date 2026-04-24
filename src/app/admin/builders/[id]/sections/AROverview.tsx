// Outstanding AR detail — collapsible panel showing every open invoice for
// the builder, bucketed by aging. Used on the Overview tab of
// /admin/builders/[id].
//
// Data model for "outstanding AR":
//   Invoice rows where status ∈ {ISSUED, SENT, PARTIALLY_PAID, OVERDUE}
//     (i.e. NOT in {DRAFT, PAID, VOID, WRITE_OFF})
//   balanceDue = total - amountPaid (already stored on the row)
//   Aging is computed from dueDate (if set) — fallback to issuedAt — fallback
//     to createdAt. Buckets: current, 1-30, 31-60, 61-90, 90+.
//
// The <details> element is native and works without client JS — important
// because page.tsx is a server component. Open by default when any bucket
// > 30 days is non-zero (drawn visually via `open` attribute in page.tsx).

import Link from 'next/link'
import { Card, CardBody, Badge } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'

export interface ARInvoiceRow {
  id: string
  invoiceNumber: string
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  issuedAt: Date | null
  dueDate: Date | null
  createdAt: Date
}

export interface AgingBuckets {
  current: number    // 0 or due in future
  days1to30: number  // 1-30 days past due
  days31to60: number
  days61to90: number
  days90plus: number
}

export interface AROverviewProps {
  invoices: ARInvoiceRow[]
  buckets: AgingBuckets
  openByDefault?: boolean
}

export function computeAgingBuckets(invoices: ARInvoiceRow[]): AgingBuckets {
  const now = Date.now()
  const b: AgingBuckets = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90plus: 0,
  }
  for (const inv of invoices) {
    const anchor = inv.dueDate || inv.issuedAt || inv.createdAt
    const daysPast = Math.floor(
      (now - new Date(anchor).getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysPast <= 0) b.current += inv.balanceDue
    else if (daysPast <= 30) b.days1to30 += inv.balanceDue
    else if (daysPast <= 60) b.days31to60 += inv.balanceDue
    else if (daysPast <= 90) b.days61to90 += inv.balanceDue
    else b.days90plus += inv.balanceDue
  }
  return b
}

function ageLabel(inv: ARInvoiceRow): { days: number; label: string; variant: 'neutral' | 'info' | 'warning' | 'danger' } {
  const anchor = inv.dueDate || inv.issuedAt || inv.createdAt
  const days = Math.floor(
    (Date.now() - new Date(anchor).getTime()) / (1000 * 60 * 60 * 24)
  )
  if (days <= 0) return { days, label: 'Current', variant: 'neutral' }
  if (days <= 30) return { days, label: `${days}d`, variant: 'info' }
  if (days <= 60) return { days, label: `${days}d`, variant: 'warning' }
  return { days, label: `${days}d`, variant: 'danger' }
}

export default function AROverview({
  invoices,
  buckets,
  openByDefault = false,
}: AROverviewProps) {
  const total =
    buckets.current +
    buckets.days1to30 +
    buckets.days31to60 +
    buckets.days61to90 +
    buckets.days90plus

  if (invoices.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-fg-muted">
                Outstanding AR
              </div>
              <div className="text-2xl font-semibold text-fg mt-1">
                {formatCurrency(0)}
              </div>
            </div>
            <div className="text-sm text-fg-muted">No open invoices</div>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody>
        <details open={openByDefault}>
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-fg-muted">
                  Outstanding AR
                </div>
                <div className="text-2xl font-semibold text-fg mt-1">
                  {formatCurrency(total)}
                </div>
                <div className="text-xs text-fg-muted mt-1">
                  {invoices.length} open invoice{invoices.length === 1 ? '' : 's'} — click to expand
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <AgeChip label="Current" amount={buckets.current} variant="neutral" />
                <AgeChip label="1-30d" amount={buckets.days1to30} variant="info" />
                <AgeChip label="31-60d" amount={buckets.days31to60} variant="warning" />
                <AgeChip label="61-90d" amount={buckets.days61to90} variant="warning" />
                <AgeChip label="90+d" amount={buckets.days90plus} variant="danger" />
              </div>
            </div>
          </summary>

          <div className="mt-4 pt-4 border-t border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-fg-muted">
                  <th className="py-2 pr-3">Invoice #</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Issued</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3 text-right">Balance</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const age = ageLabel(inv)
                  return (
                    <tr key={inv.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/ops/invoices?invoiceId=${inv.id}`}
                          className="text-brand hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={statusVariant(inv.status)} size="sm">
                          {inv.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-fg-muted">
                        {formatDate(inv.issuedAt)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-fg-muted">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={age.variant} size="sm">
                          {age.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold">
                        {formatCurrency(inv.balanceDue)}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/ops/invoices?invoiceId=${inv.id}`}
                          className="text-xs text-brand hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={5} className="py-2 text-right text-xs uppercase tracking-wide text-fg-muted">
                    Total outstanding
                  </td>
                  <td className="py-2 text-right font-bold">
                    {formatCurrency(total)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </CardBody>
    </Card>
  )
}

function AgeChip({
  label,
  amount,
  variant,
}: {
  label: string
  amount: number
  variant: 'neutral' | 'info' | 'warning' | 'danger'
}) {
  const tone = amount > 0 ? variant : 'neutral'
  return (
    <div
      className="px-2 py-1 rounded-md border border-border text-fg"
      style={{
        background:
          tone === 'danger'
            ? 'color-mix(in srgb, var(--data-negative) 8%, transparent)'
            : tone === 'warning'
            ? 'color-mix(in srgb, var(--data-warning) 8%, transparent)'
            : tone === 'info'
            ? 'color-mix(in srgb, var(--data-info) 8%, transparent)'
            : 'transparent',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="font-mono font-semibold text-xs">{formatCurrency(amount)}</div>
    </div>
  )
}

function statusVariant(status: string): 'neutral' | 'info' | 'warning' | 'danger' | 'success' {
  switch (status) {
    case 'OVERDUE':
      return 'danger'
    case 'PARTIALLY_PAID':
      return 'warning'
    case 'SENT':
    case 'ISSUED':
      return 'info'
    case 'PAID':
      return 'success'
    default:
      return 'neutral'
  }
}
