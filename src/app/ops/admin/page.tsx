'use client'

import Link from 'next/link'
import { PageHeader, Card, CardBody } from '@/components/ui'

interface AdminLink {
  href: string
  label: string
  description: string
  icon: string
}

const ADMIN_LINKS: AdminLink[] = [
  {
    href: '/ops/admin/system-health',
    label: 'System Health',
    description: 'One-glance view of cascades, orphans, inbox, integrations, crons.',
    icon: 'SH',
  },
  {
    href: '/ops/admin/ai-usage',
    label: 'AI Usage',
    description: 'Anthropic API spend, endpoint breakdown, and recent invocations.',
    icon: 'AI',
  },
  {
    href: '/ops/admin/crons',
    label: 'Crons',
    description: 'Scheduled jobs — history, last-run status, and failure surface.',
    icon: 'CR',
  },
  {
    href: '/ops/admin/data-quality',
    label: 'Data Quality',
    description: 'Drift checks, orphaned records, referential integrity.',
    icon: 'DQ',
  },
  {
    href: '/ops/admin/trends',
    label: 'Trends',
    description: 'System-level usage and growth signals over time.',
    icon: 'TR',
  },
  {
    href: '/ops/admin/data-repair',
    label: 'Data Repair',
    description: 'Drift review queue. Approve / reject header rebuilds per order (Dawn + Nate).',
    icon: 'DR',
  },
]

export default function AdminIndexPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        description="Operations control surfaces — telemetry, crons, data quality."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin' },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ADMIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block group"
          >
            <Card className="h-full transition-colors group-hover:border-[#C6A24E]">
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-md bg-[#0f2a3e] text-white flex items-center justify-center text-xs font-semibold">
                    {link.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 group-hover:text-[#0f2a3e]">
                      {link.label}
                    </h3>
                    <p className="text-xs text-gray-600 mt-1">{link.description}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
