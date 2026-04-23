import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// Curri — Deferred (2026-04-22)
// ──────────────────────────────────────────────────────────────────────────
// The Curri integration was never wired up. In-house drivers handle all
// deliveries today (Austin Collett, Aaron Treadaway, Jack Zenker, Noah
// Ridge under Jordyn Steider). We kept the route present so old links
// don't 404, but it's a dead stop — no booking, no tracking, no comparison.
// See memory/projects/delivery-partners.md.
// ──────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export default function CurriDeferredPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Curri — Not Integrated</h1>
            <p className="text-blue-200 mt-2">
              Third-party delivery partner evaluation deferred.
            </p>
          </div>
          <Link
            href="/ops/delivery"
            className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
          >
            Delivery Center
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-4">
          <h2 className="text-xl font-bold text-[#1e3a5f]">Curri not integrated</h2>
          <p className="text-gray-700">
            The Curri third-party delivery integration has been deferred. Abel
            runs deliveries in-house under Jordyn Steider and the four-driver
            team. Re-evaluate if in-house capacity ever becomes the bottleneck.
          </p>
          <p className="text-sm text-gray-500">
            See <code>memory/projects/delivery-partners.md</code> for the
            history and re-evaluation criteria.
          </p>
          <div className="pt-2">
            <Link
              href="/ops/delivery"
              className="inline-flex items-center gap-2 text-sm font-medium text-[#0f2a3e] hover:underline"
            >
              Back to Delivery Center
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
