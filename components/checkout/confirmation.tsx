'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Check, Loader, Phone } from '@/components/icons'
import { getPurchaseStatus, type PurchaseStatus } from '@/app/actions/purchase'

/** tel: href for an Israeli number as typed in settings (058-787-6549 -> +972587876549). */
function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('0') ? `tel:+972${digits.slice(1)}` : `tel:${digits}`
}

export function Confirmation({ giftCardId, contactPhone }: { giftCardId: string; contactPhone: string }) {
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
  // Provider callback is taking longer than our polite polling window. The
  // payment likely succeeded (the provider redirected here) but the verifying
  // webhook hasn't landed yet — reassure instead of spinning forever.
  const finalizing = stillProcessing && tries >= 20

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
      ) : finalizing ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-foreground">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-2xl">תודה שבחרתם להעניק מתנה עם סיפור ומשמעות</h1>
          <div className="mx-auto mt-4 max-w-md space-y-4 text-muted-foreground">
            <p>
              לאחר שהתשלום ייקלט במערכת, שובר המתנה יישלח ישירות לכתובת המייל של מקבל המתנה, ואתם
              תקבלו למייל אישור על ביצוע התשלום.
            </p>
            <p>אנא ודאו שאישור התשלום התקבל בתיבת המייל שלכם.</p>
            <p>
              אם לא קיבלתם אותו בתוך מספר דקות, או אם יש לכם שאלה או שאתם זקוקים לעזרה, נשמח לעמוד
              לרשותכם.
            </p>
            {contactPhone && (
              <p className="flex items-center justify-center gap-2 font-medium text-foreground">
                <Phone className="h-4 w-4 text-primary" />
                <span>טלפון:</span>
                <a href={telHref(contactPhone)} dir="ltr" style={{ unicodeBidi: 'embed' }} className="underline-offset-2 hover:underline">
                  {contactPhone}
                </a>
              </p>
            )}
            <p>מחכים לארח אתכם במתחם Just a Second, בגין 34, תל אביב.</p>
            <p>תודה שבחרתם להיות חלק מהעשייה שלנו.</p>
          </div>
          <div className="mt-6 flex justify-center">
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
        </>
      )}
    </div>
  )
}
