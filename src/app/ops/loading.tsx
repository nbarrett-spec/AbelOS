export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-64 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-96" />
      </div>

      {/* Key metrics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
            <div className="h-7 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-2 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>

      {/* Main dashboard grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Main metrics */}
        <div className="lg:col-span-2 space-y-6">
          {/* Orders overview */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
            <div className="h-64 bg-gray-200 rounded" />
          </div>

          {/* Recent activity */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="py-3 border-b border-gray-200 last:border-0">
                <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-64" />
              </div>
            ))}
          </div>
        </div>

        {/* Right column - Alerts and tasks */}
        <div className="space-y-6">
          {/* Critical alerts */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="py-3 border-l-4 border-red-300 pl-4 mb-3 last:mb-0">
                <div className="h-3 bg-gray-200 rounded w-40 mb-2" />
                <div className="h-2 bg-gray-200 rounded w-32" />
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded mb-3 last:mb-0" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
