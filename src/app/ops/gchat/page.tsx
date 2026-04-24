'use client'

import { useEffect, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Google Chat Integration Configuration Page
// ──────────────────────────────────────────────────────────────────────────

interface GChatChannel {
  id: string
  name: string
  description: string
  webhookUrl: string
  active: boolean
}

interface ChannelState extends GChatChannel {
  loading: boolean
  message: string | null
  messageType: 'success' | 'error' | null
  showWebhookUrl: boolean
}

export default function GoogleChatPage() {
  const [channels, setChannels] = useState<ChannelState[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(0)

  // Fetch current configuration on mount
  useEffect(() => {
    fetchChannels()
  }, [])

  async function fetchChannels() {
    try {
      const res = await fetch('/api/ops/gchat')
      if (!res.ok) throw new Error('Failed to fetch channels')
      const data = await res.json()
      setConfigured(data.configured)
      setChannels(
        data.channels.map((ch: GChatChannel) => ({
          ...ch,
          loading: false,
          message: null,
          messageType: null,
          showWebhookUrl: false,
        }))
      )
    } catch (e) {
      console.error('Failed to load channels:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(channelId: string) {
    const channel = channels.find(c => c.id === channelId)
    if (!channel || !channel.webhookUrl.trim()) {
      setChannels(
        channels.map(c =>
          c.id === channelId
            ? {
                ...c,
                message: 'Webhook URL is required',
                messageType: 'error',
              }
            : c
        )
      )
      return
    }

    setChannels(channels.map(c => (c.id === channelId ? { ...c, loading: true } : c)))

    try {
      const res = await fetch('/api/ops/gchat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          channelId,
          webhookUrl: channel.webhookUrl.trim(),
          name: channel.name,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save')
      }

      setChannels(
        channels.map(c =>
          c.id === channelId
            ? {
                ...c,
                active: true,
                message: 'Channel configured successfully',
                messageType: 'success',
              }
            : c
        )
      )
      setConfigured(prev => prev + 1)

      // Clear success message after 3 seconds
      setTimeout(() => {
        setChannels(
          channels.map(c =>
            c.id === channelId
              ? { ...c, message: null, messageType: null }
              : c
          )
        )
      }, 3000)
    } catch (e) {
      setChannels(
        channels.map(c =>
          c.id === channelId
            ? {
                ...c,
                message: e instanceof Error ? e.message : 'Error saving channel',
                messageType: 'error',
              }
            : c
        )
      )
    } finally {
      setChannels(channels.map(c => (c.id === channelId ? { ...c, loading: false } : c)))
    }
  }

  async function handleTest(channelId: string) {
    setChannels(channels.map(c => (c.id === channelId ? { ...c, loading: true } : c)))

    try {
      const res = await fetch('/api/ops/gchat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          channelId,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Test failed')
      }

      setChannels(
        channels.map(c =>
          c.id === channelId
            ? {
                ...c,
                message: 'Test message sent successfully',
                messageType: 'success',
              }
            : c
        )
      )

      setTimeout(() => {
        setChannels(
          channels.map(c =>
            c.id === channelId
              ? { ...c, message: null, messageType: null }
              : c
          )
        )
      }, 3000)
    } catch (e) {
      setChannels(
        channels.map(c =>
          c.id === channelId
            ? {
                ...c,
                message: e instanceof Error ? e.message : 'Test failed',
                messageType: 'error',
              }
            : c
        )
      )
    } finally {
      setChannels(channels.map(c => (c.id === channelId ? { ...c, loading: false } : c)))
    }
  }

  function handleWebhookChange(channelId: string, value: string) {
    setChannels(
      channels.map(c =>
        c.id === channelId ? { ...c, webhookUrl: value } : c
      )
    )
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Google Chat Integration
        </h1>
        <p className="text-gray-600">
          Connect Abel OS alerts and updates to your Google Chat spaces
        </p>
      </div>

      {/* Instructions Card */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-amber-900 mb-3">
          How to get a webhook URL
        </h2>
        <ol className="space-y-2 text-sm text-amber-800 list-decimal list-inside">
          <li>Open Google Chat and select the space where you want to receive messages</li>
          <li>Click the space name or settings icon at the top</li>
          <li>Select "Apps & integrations"</li>
          <li>Find "Webhooks" and create a new webhook</li>
          <li>Copy the webhook URL and paste it below</li>
        </ol>
      </div>

      {/* Summary */}
      {channels.length > 0 && (
        <div className="mb-8">
          <p className="text-sm font-medium text-gray-700">
            {configured} of {channels.length} channels configured
          </p>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${(configured / channels.length) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Channel Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {channels.map(channel => (
          <div
            key={channel.id}
            className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Channel Header */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {channel.name}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {channel.description}
              </p>
            </div>

            {/* Status Badge */}
            <div className="mb-4">
              {channel.active ? (
                <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-medium">
                  Connected
                </span>
              ) : (
                <span className="inline-block bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-medium">
                  Not configured
                </span>
              )}
            </div>

            {/* Webhook URL Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Webhook URL
              </label>
              <div className="relative">
                <input
                  type={channel.showWebhookUrl ? 'text' : 'password'}
                  value={channel.webhookUrl}
                  onChange={e => handleWebhookChange(channel.id, e.target.value)}
                  placeholder="https://chat.googleapis.com/v1/spaces/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => {
                    setChannels(
                      channels.map(c =>
                        c.id === channel.id
                          ? { ...c, showWebhookUrl: !c.showWebhookUrl }
                          : c
                      )
                    )
                  }}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 text-xs font-medium"
                >
                  {channel.showWebhookUrl ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Message Feedback */}
            {channel.message && (
              <div
                className={`mb-4 px-3 py-2 rounded text-sm ${
                  channel.messageType === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {channel.message}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleSave(channel.id)}
                disabled={channel.loading}
                className="flex-1 bg-signal hover:bg-amber-700 disabled:bg-gray-400 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
              >
                {channel.loading ? 'Saving...' : 'Save'}
              </button>
              {channel.active && (
                <button
                  onClick={() => handleTest(channel.id)}
                  disabled={channel.loading}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-300 text-gray-900 py-2 px-4 rounded-md text-sm font-medium transition-colors"
                >
                  {channel.loading ? 'Testing...' : 'Test'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {channels.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No channels configured yet</p>
        </div>
      )}
    </div>
  )
}
