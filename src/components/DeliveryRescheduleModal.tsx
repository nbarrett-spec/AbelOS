'use client'

import { useState, useEffect } from 'react'
import { useDeliveryReschedule, type DeliveryWindow, type AvailableSlot } from '@/hooks/useDeliveryReschedule'

interface DeliveryRescheduleModalProps {
  deliveryId: string
  deliveryNumber: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const WINDOW_LABELS: Record<DeliveryWindow, string> = {
  EARLY_AM: 'Early Morning (7-9am)',
  LATE_AM: 'Late Morning (9-11am)',
  EARLY_PM: 'Early Afternoon (12-2pm)',
  LATE_PM: 'Late Afternoon (2-4pm)',
  ANYTIME: 'Anytime (Flexible)',
}

export function DeliveryRescheduleModal({
  deliveryId,
  deliveryNumber,
  isOpen,
  onClose,
  onSuccess,
}: DeliveryRescheduleModalProps) {
  const {
    loading,
    error: hookError,
    availableSlots,
    fetchAvailableSlots,
    requestReschedule,
  } = useDeliveryReschedule(deliveryId)

  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedWindow, setSelectedWindow] = useState<DeliveryWindow>(
    'ANYTIME'
  )
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccess(false)
      setReason('')
      setSelectedWindow('ANYTIME')
      fetchAvailableSlots()
    }
  }, [isOpen, fetchAvailableSlots])

  const slotsForDate = selectedDate
    ? availableSlots.filter((slot) => slot.date === selectedDate)
    : []

  const selectedSlot = slotsForDate.find((slot) => slot.window === selectedWindow)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedDate || !selectedWindow) {
      setError('Please select a date and time window')
      return
    }

    try {
      setSubmitting(true)
      await requestReschedule(selectedDate, selectedWindow, reason || undefined)
      setSuccess(true)
      setTimeout(() => {
        onClose()
        onSuccess?.()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request reschedule')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  const minDateStr = minDate.toISOString().split('T')[0]

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 7)
  const maxDateStr = maxDate.toISOString().split('T')[0]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <h2
          style={{
            fontSize: '20px',
            fontWeight: 'bold',
            marginBottom: '16px',
            color: '#1B4F72',
          }}
        >
          Request Reschedule
        </h2>

        <p
          style={{
            fontSize: '14px',
            color: '#666',
            marginBottom: '20px',
          }}
        >
          Delivery {deliveryNumber}
        </p>

        {success && (
          <div
            style={{
              backgroundColor: '#d1fae5',
              border: '1px solid #6ee7b7',
              borderRadius: '6px',
              padding: '12px',
              color: '#065f46',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            Reschedule requested! You'll be notified when confirmed.
          </div>
        )}

        {(error || hookError) && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              padding: '12px',
              color: '#991b1b',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            {error || hookError}
          </div>
        )}

        {!success && (
          <form onSubmit={handleSubmit}>
            {/* Date Picker */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '6px',
                  color: '#333',
                }}
              >
                Preferred Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                min={minDateStr}
                max={maxDateStr}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: loading ? '#f5f5f5' : 'white',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              />
              <p
                style={{
                  fontSize: '12px',
                  color: '#999',
                  marginTop: '4px',
                }}
              >
                Select a date within the next 5 business days
              </p>
            </div>

            {/* Window Selector */}
            {selectedDate && slotsForDate.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginBottom: '8px',
                    color: '#333',
                  }}
                >
                  Preferred Time Window
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                  }}
                >
                  {slotsForDate.map((slot) => (
                    <div key={slot.window}>
                      <button
                        type="button"
                        onClick={() => setSelectedWindow(slot.window)}
                        disabled={slot.spotsLeft === 0}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border:
                            selectedWindow === slot.window
                              ? '2px solid #E67E22'
                              : '1px solid #ddd',
                          borderRadius: '6px',
                          backgroundColor:
                            selectedWindow === slot.window
                              ? '#fff8f3'
                              : 'white',
                          cursor:
                            slot.spotsLeft === 0
                              ? 'not-allowed'
                              : 'pointer',
                          opacity: slot.spotsLeft === 0 ? 0.5 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#333',
                            marginBottom: '4px',
                          }}
                        >
                          {WINDOW_LABELS[slot.window]}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: slot.spotsLeft > 0 ? '#666' : '#999',
                          }}
                        >
                          {slot.spotsLeft > 0
                            ? `${slot.spotsLeft} spots available`
                            : 'Full'}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reason Textarea */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '6px',
                  color: '#333',
                }}
              >
                Reason (Optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                placeholder="Tell us why you need to reschedule..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '80px',
                  backgroundColor: submitting ? '#f5f5f5' : 'white',
                }}
              />
            </div>

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  color: '#333',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedDate || !selectedWindow || loading}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: '#E67E22',
                  color: 'white',
                  cursor:
                    submitting || !selectedDate || !selectedWindow || loading
                      ? 'not-allowed'
                      : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity:
                    submitting || !selectedDate || !selectedWindow || loading
                      ? 0.6
                      : 1,
                }}
              >
                {submitting ? 'Submitting...' : 'Request Reschedule'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
