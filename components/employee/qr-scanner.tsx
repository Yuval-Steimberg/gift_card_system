'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Camera } from '@/components/icons'

/**
 * Camera QR scanner using the native BarcodeDetector API when available.
 * Accessible fallback: when the API/camera is unavailable or permission is
 * denied, we surface a clear message and the manual code entry remains the
 * primary path (never blocks redemption).
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const AnyWindow = window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect: (s: unknown) => Promise<{ rawValue: string }[]> } }
    if (!AnyWindow.BarcodeDetector) {
      setError('הסורק אינו נתמך בדפדפן זה — הזן/י את הקוד ידנית.')
      setActive(false)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('אין גישה למצלמה — הזן/י את הקוד ידנית.')
      setActive(false)
      return
    }

    const detector = new AnyWindow.BarcodeDetector({ formats: ['qr_code'] })
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0 && codes[0]?.rawValue) {
              onResult(codes[0].rawValue)
              setActive(false)
              return
            }
          } catch {
            /* transient decode error; keep scanning */
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        setError('הגישה למצלמה נדחתה — הזן/י את הקוד ידנית.')
        setActive(false)
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [active, onResult])

  return (
    <div className="space-y-2">
      {!active ? (
        <Button type="button" variant="outline" className="w-full" onClick={() => { setError(null); setActive(true) }}>
          <Camera className="h-4 w-4" />
          סריקת QR במצלמה
        </Button>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-black">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline aria-label="סורק QR" />
          <Button type="button" variant="ghost" size="sm" className="w-full rounded-none text-jas-cream" onClick={() => setActive(false)}>
            עצירת סריקה
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-warning">{error}</p>}
    </div>
  )
}
