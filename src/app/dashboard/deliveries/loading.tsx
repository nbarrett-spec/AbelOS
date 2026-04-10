export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-80" />
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="h-3 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-7 bg-gray-200 rounded w-20" />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-gray-200 rounded w-48" />
        <div className="h-10 bg-gray-200 rounded w-40" />
      </div>

      {/* Deliveries list */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="py-4 border-b border-gray-200 last:border-0">
            {/* Delivery header */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-56" />
              </div>
              <div className="h-6 bg-gray-200 rounded w-28" />
            </div>

            {/* Delivery details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-28" />
              </div>
              <div>
                <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-32" />
              </div>
              <div>
                <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-24" />
              </div>
              <div>
                <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-28" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
