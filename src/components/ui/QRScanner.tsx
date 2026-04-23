'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// QRScanner — phone-camera QR scanner.
// Replaces HID-barcode text-input on the warehouse pick flow.
//
// Usage:
//   <QRScanner
//     active={scanning}
//     onScan={code => handleScan(code)}
//     onError={e => console.error(e)}
//     prompt="Scan SKU to pick"
//   />
//
// Features:
//   - Rear camera (facingMode: 'environment')
//   - Reticle + corner markers overlay
//   - Torch toggle
//   - Haptic vibrate + short beep on scan
//   - De-dupe: same code only fires once per 2s
//   - Graceful text-input fallback when camera is blocked / unavailable
//   - Full-screen mode toggle
// ────────────────────────────────────────────────────────────────────────────

export interface QRScannerProps {
  onScan: (code: string) => void
  onError?: (err: unknown) => void
  active: boolean
  prompt?: string
}

const DEDUPE_WINDOW_MS = 2000
const TAP_TARGET = 48

type LibState = 'loading' | 'ready' | 'unavailable'

export default function QRScanner({ onScan, onError, active, prompt }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scannerRef = useRef<any>(null) // QrScanner instance
  const lastScanRef = useRef<{ code: string; at: number } | null>(null)

  const [libState, setLibState] = useState<LibState>('loading')
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  // ── Feedback (beep + vibrate) ───────────────────────────────────────────
  const playBeep = useCallback(() => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 500
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.08)
    } catch {
      /* audio blocked — non-fatal */
    }
  }, [])

  const vibrate = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(50)
      }
    } catch {
      /* no-op */
    }
  }, [])

  const fireScan = useCallback(
    (code: string) => {
      const now = Date.now()
      const last = lastScanRef.current
      if (last && last.code === code && now - last.at < DEDUPE_WINDOW_MS) {
        return // debounce: same tag within 2s — ignore
      }
      lastScanRef.current = { code, at: now }
      vibrate()
      playBeep()
      try {
        onScan(code)
      } catch (err) {
        onError?.(err)
      }
    },
    [onScan, onError, vibrate, playBeep]
  )

  // ── Detect camera support + lazy-load qr-scanner ────────────────────────
  useEffect(() => {
    let cancelled = false

    const mediaOk =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'

    if (!mediaOk) {
      setUnsupported(true)
      setLibState('unavailable')
      setManualMode(true)
      return
    }

    // Lazy-load qr-scanner so SSR & route-level TS don't depend on the lib
    ;(async () => {
      try {
        const mod: any = await import('qr-scanner').catch(() => null)
        if (!mod) {
          if (!cancelled) {
            setLibState('unavailable')
            setManualMode(true)
          }
          return
        }
        if (!cancelled) setLibState('ready')
      } catch (err) {
        if (!cancelled) {
          setLibState('unavailable')
          setManualMode(true)
          onError?.(err)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [onError])

  // ── Start / stop the scanner when `active` toggles ──────────────────────
  useEffect(() => {
    if (!active || libState !== 'ready' || manualMode) return

    let cancelled = false
    let scanner: any = null

    ;(async () => {
      try {
        const mod: any = await import('qr-scanner')
        const QrScanner = mod.default ?? mod
        if (cancelled || !videoRef.current) return

        scanner = new QrScanner(
          videoRef.current,
          (result: any) => {
            const data = typeof result === 'string' ? result : result?.data
            if (data) fireScan(String(data))
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: false,
            highlightCodeOutline: false,
            maxScansPerSecond: 5,
          }
        )

        scannerRef.current = scanner
        await scanner.start()

        // Torch capability check
        try {
          const hasFlash = await scanner.hasFlash()
          if (!cancelled) setTorchSupported(Boolean(hasFlash))
        } catch {
          /* ignore */
        }
      } catch (err: any) {
        const msg = err?.name || err?.message || String(err)
        const denied =
          /notallowed|denied|permission/i.test(msg) ||
          err?.name === 'NotAllowedError'
        if (!cancelled) {
          if (denied) {
            setPermissionDenied(true)
            setManualMode(true)
          } else {
            setRuntimeError(typeof msg === 'string' ? msg : 'Camera error')
          }
          onError?.(err)
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        scanner?.stop?.()
        scanner?.destroy?.()
      } catch {
        /* no-op */
      }
      scannerRef.current = null
    }
  }, [active, libState, manualMode, fireScan, onError])

  // ── Torch toggle ────────────────────────────────────────────────────────
  const toggleTorch = useCallback(async () => {
    const s = scannerRef.current
    if (!s) return
    try {
      if (torchOn) {
        await s.turnFlashOff?.()
        setTorchOn(false)
      } else {
        await s.turnFlashOn?.()
        setTorchOn(true)
      }
    } catch (err) {
      // Fallback: try raw applyConstraints on the active track
      try {
        const stream = (videoRef.current?.srcObject as MediaStream) || null
        const track = stream?.getVideoTracks?.()[0]
        if (track && 'applyConstraints' in track) {
          await (track as any).applyConstraints({
            advanced: [{ torch: !torchOn }],
          })
          setTorchOn(t => !t)
        }
      } catch (e) {
        onError?.(e)
      }
    }
  }, [torchOn, onError])

  // ── Manual submit ───────────────────────────────────────────────────────
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = manualInput.trim()
    if (!v) return
    fireScan(v)
    setManualInput('')
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  const wrapperStyle: React.CSSProperties = fullscreen
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'relative',
        width: '100%',
        backgroundColor: '#000',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        border: '2px solid #C6A24E',
      }

  const videoStyle: React.CSSProperties = {
    width: '100%',
    height: fullscreen ? '100%' : 'auto',
    maxHeight: fullscreen ? '100%' : 360,
    objectFit: 'cover',
    display: 'block',
  }

  // Fallback-only view (camera blocked / unsupported)
  if (manualMode) {
    const msg = unsupported
      ? 'Camera not available on this device. Enter code manually.'
      : permissionDenied
        ? 'Camera permission denied. Enable camera in your browser settings or enter code manually.'
        : libState === 'unavailable'
          ? 'QR decoder unavailable. Enter code manually.'
          : prompt || 'Enter code manually'

    return (
      <div
        style={{
          backgroundColor: '#2a2a3e',
          border: '2px solid #C6A24E',
          borderRadius: '0.75rem',
          padding: '1rem',
          color: '#fff',
        }}
      >
        <div
          style={{
            fontSize: '0.875rem',
            color: '#ccc',
            marginBottom: '0.5rem',
            fontWeight: 'bold',
            textTransform: 'uppercase',
          }}
        >
          Manual entry
        </div>
        <div style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '0.75rem' }}>
          {msg}
        </div>
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            autoFocus
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="Scan or type code..."
            style={{
              flex: 1,
              minHeight: TAP_TARGET,
              padding: '0.75rem 1rem',
              fontSize: '1.1rem',
              backgroundColor: '#1a1a2e',
              color: '#fff',
              border: '2px solid #444',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
            autoComplete="off"
          />
          <button
            type="submit"
            style={{
              minHeight: TAP_TARGET,
              padding: '0 1.25rem',
              backgroundColor: '#C6A24E',
              color: '#1a1a2e',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Submit
          </button>
        </form>
        {!unsupported && libState === 'ready' && (
          <button
            type="button"
            onClick={() => {
              setManualMode(false)
              setPermissionDenied(false)
              setRuntimeError(null)
            }}
            style={{
              marginTop: '0.75rem',
              background: 'transparent',
              color: '#C6A24E',
              border: '1px solid #444',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              minHeight: TAP_TARGET,
            }}
          >
            Try camera again
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={wrapperStyle}>
      <video ref={videoRef} style={videoStyle} muted playsInline />

      {/* Reticle overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 'min(60vw, 240px)',
            height: 'min(60vw, 240px)',
            maxWidth: '80%',
            position: 'relative',
          }}
        >
          {/* Corner markers */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(corner => {
            const size = 28
            const thickness = 4
            const color = '#C6A24E'
            const common: React.CSSProperties = {
              position: 'absolute',
              width: size,
              height: size,
              borderColor: color,
              borderStyle: 'solid',
            }
            const variant: Record<typeof corner, React.CSSProperties> = {
              tl: { top: 0, left: 0, borderWidth: `${thickness}px 0 0 ${thickness}px` },
              tr: { top: 0, right: 0, borderWidth: `${thickness}px ${thickness}px 0 0` },
              bl: { bottom: 0, left: 0, borderWidth: `0 0 ${thickness}px ${thickness}px` },
              br: {
                bottom: 0,
                right: 0,
                borderWidth: `0 ${thickness}px ${thickness}px 0`,
              },
            }
            return <div key={corner} style={{ ...common, ...variant[corner] }} />
          })}
          {/* Center line sweep */}
          <div
            style={{
              position: 'absolute',
              left: '10%',
              right: '10%',
              top: '50%',
              height: 2,
              backgroundColor: 'rgba(198, 162, 78, 0.85)',
              boxShadow: '0 0 8px #C6A24E',
            }}
          />
        </div>
      </div>

      {/* Prompt banner */}
      {prompt && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(0,0,0,0.55)',
            color: '#fff',
            borderRadius: '0.5rem',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {prompt}
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          right: 12,
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              style={{
                minHeight: TAP_TARGET,
                minWidth: TAP_TARGET,
                padding: '0.5rem 0.75rem',
                backgroundColor: torchOn ? '#C6A24E' : 'rgba(0,0,0,0.6)',
                color: torchOn ? '#1a1a2e' : '#fff',
                border: '1px solid #C6A24E',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
              aria-label="Toggle flash"
            >
              Flash {torchOn ? 'On' : 'Off'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setManualMode(true)}
            style={{
              minHeight: TAP_TARGET,
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Type code
          </button>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen(f => !f)}
          style={{
            minHeight: TAP_TARGET,
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: '1px solid #444',
            borderRadius: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          {fullscreen ? 'Exit' : 'Fullscreen'}
        </button>
      </div>

      {/* Runtime error */}
      {runtimeError && (
        <div
          style={{
            position: 'absolute',
            bottom: 72,
            left: 12,
            right: 12,
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(231, 76, 60, 0.85)',
            color: '#fff',
            borderRadius: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: 'bold',
          }}
        >
          {runtimeError}
        </div>
      )}

      {libState === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 'bold',
          }}
        >
          Starting camera...
        </div>
      )}
    </div>
  )
}
