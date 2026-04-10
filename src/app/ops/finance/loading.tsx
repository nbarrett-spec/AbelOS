export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-96" />
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="h-3 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-2 bg-gray-200 rounded w-40" />
          </div>
        ))}
      </div>

      {/* Financial dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Financials chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>

        {/* Income statement */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex justify-between py-3 border-b border-gray-200 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-4 bg-gray-200 rounded w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Detailed tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoices table */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex justify-between py-3 border-b border-gray-200 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-28" />
              <div className="h-4 bg-gray-200 rounded w-24" />
            </div>
          ))}
        </div>

        {/* Payments table */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex justify-between py-3 border-b border-gray-200 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-28" />
              <div className="h-4 bg-gray-200 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
