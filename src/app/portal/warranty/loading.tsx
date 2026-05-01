export default function PortalWarrantyLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-44 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-72 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      <div
        className="rounded-[14px] h-[420px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
    </div>
  )
}
