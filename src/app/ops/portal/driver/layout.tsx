'use client'
import { StaffAuthGuard, DELIVERY_ROLES } from '@/components/StaffAuthGuard'
import DriverServiceWorker from './ServiceWorker'

/**
 * Driver portal layout — mobile-first, no sidebar, no navbar.
 *
 * The parent /ops layout renders a heavy sidebar that is useless in a truck
 * cab. This layout breaks out of that by suppressing the shell via CSS —
 * drivers navigate with huge buttons only.
 */
export default function DriverPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffAuthGuard requiredRoles={DELIVERY_ROLES}>
      <DriverServiceWorker />
      <div
        className="driver-portal"
        style={{
          minHeight: '100vh',
          background: 'var(--canvas, #0e1113)',
          color: 'var(--fg, #e7e1d6)',
        }}
      >
        {children}
      </div>
      {/* Hide the parent ops shell chrome when driver portal is active.
          The sidebar exists in the parent layout; we zero it out here so the
          phone gets every pixel. */}
      <style jsx global>{`
        body:has(.driver-portal) aside,
        body:has(.driver-portal) header[role='banner'],
        body:has(.driver-portal) nav[aria-label='Primary'] {
          display: none !important;
        }
        body:has(.driver-portal) main,
        body:has(.driver-portal) [data-ops-main] {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100% !important;
        }
      `}</style>
    </StaffAuthGuard>
  )
}
