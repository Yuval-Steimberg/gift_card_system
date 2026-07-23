'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Check, Loader } from '@/components/icons'
import { getPurchaseStatus, type PurchaseStatus } from '@/app/actions/purchase'

export function Confirmation({ giftCardId }: { giftCardId: string }) {
  const [status, setStatus] = useState<PurchaseStatus | null>(null)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function poll(attempt: number) {
      const res = await getPurchaseStatus(giftCardId)
      if (!active) return
      setStatus(res)
      setTries(attempt)
      // Stop once paid, or after ~20 polite attempts.
      if (res.found && !res.paid && attempt < 20) {
        timer = setTimeout(() => poll(attempt + 1), 1500)
      }
    }
    poll(1)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [giftCardId])

  const paid = status?.paid
  const stillProcessing = status?.found && !status.paid

  return (
    <div className="mx-auto max-w-lg text-center">
      {paid ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success text-success-foreground">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl">התשלום אושר</h1>
          <p className="mt-2 text-muted-foreground">
            השובר הונפק ונשלח לנמען/ת. שלחנו לך גם אישור רכישה במייל.
          </p>
          <div className="mt-6 rounded-lg border border-border bg-card p-4 text-sm">
            קוד השובר:{' '}
            <span dir="ltr" style={{ unicodeBidi: 'embed' }} className="font-mono font-bold">
              {status?.code}
            </span>
          </div>
          <div className="mt-6 flex justify-center gap-3">
            {status?.publicToken && (
              <Button asChild>
                <Link href={`/gift/${status.publicToken}`}>צפייה בשובר</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/">חזרה לדף הבית</Link>
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Loader className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-3xl">{stillProcessing ? 'מעבד תשלום…' : 'ממתין לאישור…'}</h1>
          <p className="mt-2 text-muted-foreground">
            אנחנו מאשרים את התשלום מול הספק. אין צורך לרענן — העמוד יתעדכן אוטומטית.
          </p>
          {tries >= 20 && (
            <p className="mt-4 text-sm text-muted-foreground">
              האישור מתעכב. אם חויבת, השובר יישלח ברגע שנאמת את התשלום. לשאלות פנה/י אלינו.
            </p>
          )}
        </>
      )}
    </div>
  )
}
