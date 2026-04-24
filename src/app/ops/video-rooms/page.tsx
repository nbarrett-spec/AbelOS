'use client'

import { useEffect, useState, useRef } from 'react'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { Video } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface VideoRoom {
  roomId: string
  name: string
  type: 'video' | 'voice'
  createdBy: string
  participants: string[]
  jobId: string | null
  builderId: string | null
  createdAt: string
  updatedAt: string
}

const BRAND_COLORS = {
  walnut: '#0f2a3e',
  amber: '#C6A24E',
  green: '#27AE60',
}

export default function VideoRoomsPage() {
  const { staff } = useStaffAuth()
  const [activeRooms, setActiveRooms] = useState<VideoRoom[]>([])
  const [recentRooms, setRecentRooms] = useState<VideoRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [roomName, setRoomName] = useState('')
  const [roomType, setRoomType] = useState<'video' | 'voice'>('video')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [creating, setCreating] = useState(false)
  const [activeRoom, setActiveRoom] = useState<VideoRoom | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [isMicOn, setIsMicOn] = useState(true)
  const [isCameraOn, setIsCameraOn] = useState(true)
  const [copyFeedback, setCopyFeedback] = useState(false)

  // Fetch rooms on mount
  useEffect(() => {
    fetchRooms()
  }, [])

  // Start media stream when room is created
  useEffect(() => {
    if (activeRoom && isCameraOn) {
      startMediaStream()
    }
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [activeRoom, isCameraOn])

  async function fetchRooms() {
    try {
      const response = await fetch('/api/ops/video-rooms')
      if (response.ok) {
        const data = await response.json()
        setActiveRooms(data.activeRooms || [])
        setRecentRooms(data.recentRooms || [])
      }
    } catch (error) {
      console.error('Error fetching rooms:', error)
    } finally {
      setLoading(false)
    }
  }

  async function startMediaStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isCameraOn ? { width: 320, height: 240 } : false,
        audio: isMicOn,
      })
      setMediaStream(stream)
      if (videoPreviewRef.current && isCameraOn) {
        videoPreviewRef.current.srcObject = stream
      }
    } catch (error) {
      console.error('Error accessing media devices:', error)
    }
  }

  function toggleMic() {
    if (mediaStream) {
      mediaStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMicOn(!isMicOn)
    }
  }

  function toggleCamera() {
    if (mediaStream) {
      mediaStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsCameraOn(!isCameraOn)
    }
  }

  async function createRoom(type: 'video' | 'voice') {
    if (!roomName.trim()) {
      alert('Please enter a room name')
      return
    }

    setCreating(true)
    try {
      const response = await fetch('/api/ops/video-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roomName,
          type,
          jobId: selectedJobId || undefined,
        }),
      })

      if (response.ok) {
        const newRoom = await response.json()
        setActiveRoom(newRoom)
        setRoomName('')
        setSelectedJobId('')
        // Refresh list
        await fetchRooms()
      } else {
        alert('Failed to create room')
      }
    } catch (error) {
      console.error('Error creating room:', error)
      alert('Error creating room')
    } finally {
      setCreating(false)
    }
  }

  async function endRoom(roomId: string) {
    if (!confirm('End this room?')) return

    try {
      const response = await fetch('/api/ops/video-rooms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      })

      if (response.ok) {
        setActiveRoom(null)
        if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop())
          setMediaStream(null)
        }
        await fetchRooms()
      }
    } catch (error) {
      console.error('Error ending room:', error)
    }
  }

  function copyRoomLink() {
    const link = `${window.location.origin}/ops/video-rooms/${activeRoom?.roomId}`
    navigator.clipboard.writeText(link)
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
  }

  function formatTime(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (!staff) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  // If room is active, show room view
  if (activeRoom) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-gray-900 mb-2">
              {activeRoom.type === 'video' ? '📹' : '🎤'} {activeRoom.name}
            </h1>
            <p className="text-gray-600">
              Created by {activeRoom.createdBy} at {formatTime(activeRoom.createdAt)}
            </p>
          </div>

          {/* Video Preview */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {activeRoom.type === 'video' ? 'Video Preview' : 'Audio Only'}
            </h2>
            {activeRoom.type === 'video' && (
              <video
                ref={videoPreviewRef}
                autoPlay
                muted
                className="w-full max-w-md h-80 bg-black rounded-lg object-cover"
              />
            )}
            {activeRoom.type === 'voice' && (
              <div className="w-full max-w-md h-32 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl mb-2">🎤</div>
                  <p className="text-gray-600">Voice chat active</p>
                </div>
              </div>
            )}
          </div>

          {/* Share Link */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Share Room Link
            </h3>
            <div className="flex gap-3">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/ops/video-rooms/${activeRoom.roomId}`}
                className="flex-1 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm font-mono text-gray-700"
              />
              <button
                onClick={copyRoomLink}
                className="px-6 py-2 rounded-lg font-semibold transition-colors"
                style={{
                  backgroundColor: BRAND_COLORS.amber,
                  color: 'white',
                }}
              >
                {copyFeedback ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Share this link with teammates to join the room
            </p>
          </div>

          {/* Controls */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Controls</h3>
            <div className="flex gap-3">
              {activeRoom.type === 'video' && (
                <button
                  onClick={toggleCamera}
                  className={`px-6 py-2 rounded-lg font-semibold transition-colors text-white`}
                  style={{
                    backgroundColor: isCameraOn ? BRAND_COLORS.green : '#9CA3AF',
                  }}
                >
                  {isCameraOn ? '📹 Camera On' : '📹 Camera Off'}
                </button>
              )}
              <button
                onClick={toggleMic}
                className={`px-6 py-2 rounded-lg font-semibold transition-colors text-white`}
                style={{
                  backgroundColor: isMicOn ? BRAND_COLORS.green : '#9CA3AF',
                }}
              >
                {isMicOn ? '🎤 Mic On' : '🎤 Mic Off'}
              </button>
              <button
                onClick={() => endRoom(activeRoom.roomId)}
                className="px-6 py-2 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                End Call
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700">
              <strong>MVP Note:</strong> Full peer-to-peer calling coming in v2. For now,
              use the shareable link to coordinate with teammates. The preview above confirms
              your camera and microphone are working.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Main view: create room + list rooms
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6">
        <PageHeader
          title="Video & Voice Rooms"
          description="Start instant team calls"
        />

        {/* Quick Launch Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Launch</h2>

          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room Name
              </label>
              <input
                type="text"
                placeholder={`${staff?.firstName || 'Team'}'s Room`}
                value={roomName}
                onChange={e => setRoomName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:outline-none"
                style={{ outlineColor: BRAND_COLORS.amber }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    createRoom('video')
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Link to Job (optional)
              </label>
              <input
                type="text"
                placeholder="Job ID or name"
                value={selectedJobId}
                onChange={e => setSelectedJobId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:outline-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => createRoom('video')}
                disabled={creating || !roomName.trim()}
                className="flex-1 px-6 py-3 rounded-lg font-semibold text-white transition-opacity"
                style={{
                  backgroundColor: BRAND_COLORS.amber,
                  opacity: creating || !roomName.trim() ? 0.5 : 1,
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                📹 Start Video Call
              </button>
              <button
                onClick={() => createRoom('voice')}
                disabled={creating || !roomName.trim()}
                className="flex-1 px-6 py-3 rounded-lg font-semibold text-white transition-opacity"
                style={{
                  backgroundColor: BRAND_COLORS.green,
                  opacity: creating || !roomName.trim() ? 0.5 : 1,
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                🎤 Start Voice Call
              </button>
            </div>
          </div>
        </div>

        {/* Active Rooms */}
        {activeRooms.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Active Rooms</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeRooms.map(room => (
                <div key={room.roomId} className="bg-white rounded-lg shadow-md p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900">{room.name}</h3>
                    <span className="text-lg">
                      {room.type === 'video' ? '📹' : '🎤'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Started by {room.createdBy} at {formatTime(room.createdAt)}
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    {room.participants.length} participant{room.participants.length !== 1 ? 's' : ''}
                  </p>
                  {room.jobId && (
                    <p className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded mb-3">
                      Job: {room.jobId}
                    </p>
                  )}
                  <a
                    href={`/ops/video-rooms/${room.roomId}`}
                    className="w-full px-4 py-2 rounded-lg font-semibold text-white text-center transition-opacity inline-block"
                    style={{
                      backgroundColor: BRAND_COLORS.green,
                    }}
                  >
                    Join
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Rooms */}
        {recentRooms.length > 0 && (
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Recent Rooms</h2>
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <table className="w-full">
                <thead style={{ backgroundColor: `${BRAND_COLORS.walnut}15` }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Created By
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Started
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Participants
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentRooms.map(room => (
                    <tr key={room.roomId} className="hover:bg-row-hover">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {room.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {room.type === 'video' ? '📹 Video' : '🎤 Voice'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {room.createdBy}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatTime(room.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {room.participants.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && activeRooms.length === 0 && recentRooms.length === 0 && (
          <div className="bg-white rounded-lg shadow-md">
            <EmptyState
              icon={<Video className="w-8 h-8 text-fg-subtle" />}
              title="No Rooms Yet"
              description="Create a room above to start a video or voice call with your team."
            />
          </div>
        )}
      </div>
    </div>
  )
}
