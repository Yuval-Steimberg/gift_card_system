'use client'

import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Button } from '@/components/ui/button'
import { Camera } from '@/components/icons'

/**
 * Camera QR scanner that works in EVERY browser with a camera.
 *
 * Decoding path: the native `BarcodeDetector` API when the browser has it
 * (Chrome/Android — fastest), otherwise a pure-JS fallback (`jsQR`) that reads
 * frames off a canvas — which covers Safari and Firefox, neither of which
 * implements BarcodeDetector. The only hard requirement is `getUserMedia`
 * (camera access over HTTPS), available in all modern browsers. Manual code
 * entry always remains as the ultimate fallback and never blocks redemption.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('אין גישה למצלמה בדפדפן זה — הזן/י את הקוד ידנית.')
      setActive(false)
      return
    }

    // Native detector when available (Chrome/Android); else pure-JS jsQR.
    type NativeDetector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }
    const AnyWindow = window as unknown as { BarcodeDetector?: new (o?: unknown) => NativeDetector }
    const nativeDetector: NativeDetector | null = AnyWindow.BarcodeDetector
      ? new AnyWindow.BarcodeDetector({ formats: ['qr_code'] })
      : null

    const finish = (value: string) => {
      if (cancelled || !value) return
      onResult(value)
      setActive(false)
    }

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
          const video = videoRef.current
          try {
            if (nativeDetector) {
              const codes = await nativeDetector.detect(video)
              if (codes.length > 0 && codes[0]?.rawValue) return finish(codes[0].rawValue)
            } else if (video.readyState >= 2 && video.videoWidth > 0) {
              // jsQR path: draw the current frame to a canvas and decode its pixels.
              const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'))
              canvas.width = video.videoWidth
              canvas.height = video.videoHeight
              const ctx = canvas.getContext('2d', { willReadFrequently: true })
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
                if (code?.data) return finish(code.data)
              }
            }
          } catch {
            /* transient decode error; keep scanning */
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        setError('הגישה למצלמה נדחתה — אשר/י גישה למצלמה או הזן/י את הקוד ידנית.')
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
