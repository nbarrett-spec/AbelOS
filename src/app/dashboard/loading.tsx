export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-64 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-96" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-2 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>

      {/* Main content area with tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - projects and orders */}
        <div className="lg:col-span-2 space-y-6">
          {/* Projects section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="py-4 border-b border-gray-200 last:border-0">
                <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-64" />
              </div>
            ))}
          </div>

          {/* Orders section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-4 py-3 border-b border-gray-200 last:border-0">
                <div className="h-4 bg-gray-200 rounded w-20" />
                <div className="h-4 bg-gray-200 rounded w-40 flex-1" />
                <div className="h-4 bg-gray-200 rounded w-24" />
              </div>
            ))}
          </div>
        </div>

        {/* Right column - notifications and activity */}
        <div className="space-y-6">
          {/* Notifications */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-28 mb-4" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="py-3 border-b border-gray-200 last:border-0">
                <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
                <div className="h-2 bg-gray-200 rounded w-full" />
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded mb-3 last:mb-0" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
