import Link from 'next/link'
import { ArrowLeft, Box } from 'lucide-react'

export default function PortalProductNotFound() {
  return (
    <div className="max-w-md mx-auto py-16 text-center space-y-4">
      <div
        className="w-14 h-14 mx-auto rounded-full flex items-center justify-center"
        style={{
          background: 'var(--portal-bg-elevated, #FAF5E8)',
          color: 'var(--c1)',
        }}
      >
        <Box className="w-7 h-7" />
      </div>
      <h1
        className="text-xl font-medium"
        style={{
          fontFamily: 'var(--font-portal-display)',
          color: 'var(--portal-text-strong, #3E2A1E)',
        }}
      >
        Product not found
      </h1>
      <p
        className="text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        We couldn&apos;t find that product. It may have been discontinued.
      </p>
      <Link
        href="/portal/catalog"
        className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          color: 'var(--portal-text-strong, #3E2A1E)',
          border: '1px solid var(--portal-border, #E8DFD0)',
        }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to catalog
      </Link>
    </div>
  )
}
