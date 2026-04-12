'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface FailedJob {
  id: string
  jobNumber: string
  builderName: string
  failedAt: string
  defectNotes: string | null
  status: string
}

interface QCBriefing {
  failedJobs: FailedJob[]
}

export default function QCReworkPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [reworkQueue, setReworkQueue] = useState<FailedJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/ops/qc-briefing')
        if (res.ok) {
          const data: QCBriefing = await res.json()
          setReworkQueue(data.failedJobs || [])
        }
      } catch (error) {
        console.error('Failed to load rework queue:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const handleReInspect = async (job: FailedJob) => {
    try {
      // Create a new QC check for re-inspection
      const res = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          checkType: 'RE_INSPECTION',
          result: 'PENDING',
          notes: 'Re-inspection scheduled for failed job'
        })
      })

      if (res.ok) {
        // Navigate to QC queue with the job ID
        router.push(`/ops/portal/qc/queue?jobId=${job.id}`)
      } else {
        addToast({ type: 'error', title: 'Creation Failed', message: 'Failed to create re-inspection. Please try again.' })
      }
    } catch (error) {
      console.error('Error creating re-inspection:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error creating re-inspection' })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C0392B]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rework Queue</h1>
          <p className="text-gray-600 mt-1">Jobs that failed QC and need re-inspection</p>
        </div>
        <Link
          href="/ops/portal/qc"
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 uppercase">Jobs Awaiting Rework</p>
            <p className="text-4xl font-bold text-[#C0392B] mt-2">{reworkQueue.length}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Last 30 days</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">Re-inspections Needed</p>
          </div>
        </div>
      </div>

      {/* Rework Queue */}
      <div className="bg-white rounded-xl border p-6">
        {reworkQueue.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-3xl mb-2">🎉</p>
            <p className="text-lg">No rework needed!</p>
            <p className="text-sm mt-1">All jobs have passed QC or are being corrected</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Job #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Builder</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Defect Notes</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Failed Date</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600 text-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {reworkQueue.map((job) => (
                  <tr key={job.id} className="border-b border-gray-100 hover:bg-red-50 transition-all">
                    <td className="py-4 px-4">
                      <Link href={`/ops/jobs/${job.id}`} className="font-semibold text-[#C0392B] hover:text-[#A93226]">
                        {job.jobNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-4 font-medium text-gray-900">{job.builderName}</td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-red-700 max-w-xs line-clamp-2">{job.defectNotes || 'No notes'}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        {job.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {new Date(job.failedAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <Link href={`/ops/jobs/${job.id}`}>
                          <button className="px-3 py-1.5 bg-[#C0392B] text-white rounded text-xs font-medium hover:bg-[#A93226] transition-colors">
                            Review
                          </button>
                        </Link>
                        <button
                          onClick={() => handleReInspect(job)}
                          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-50 transition-colors"
                        >
                          Re-inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tips section */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-3">Rework Process</h3>
        <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
          <li>Review the defect notes and photos from the failed inspection</li>
          <li>Contact the crew/builder with specific defect details</li>
          <li>Schedule rework completion date</li>
          <li>Once repairs are complete, perform re-inspection</li>
          <li>Update job status when QC passes</li>
        </ol>
      </div>
    </div>
  )
}
