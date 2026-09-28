'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { adminResendAllFailed } from '@/app/admin/actions'

/**
 * Loud, top-of-dashboard warning for paid cards whose email never went out.
 * A number in a grid of tiles is easy to miss — and a provider outage (SendGrid's
 * trial ending) left every new card undelivered for days without anyone noticing.
 */
export function FailedDeliveryAlert({ count, canResend }: { count: number; canResend: boolean }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rejected, setRejected] = useState<{ id: string; code: string; recipientEmail: string }[]>([])

  if (count === 0 && !msg) return null

  const resendAll = () => {
    setMsg(null)
    start(async () => {
      const res = await adminResendAllFailed()
      setRejected(res.rejected ?? [])
      setMsg({
        ok: res.ok,
        text: res.ok
          ? res.queued
            ? `נשלחו מחדש ${res.delivered} שוברים.`
            : 'אין שוברים לשליחה חוזרת.'
          : (res.message ?? 'שגיאה'),
      })
    })
  }

  return (
    <div role="alert" className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
      {count > 0 && (
        <>
          <div className="font-semibold text-destructive">
            {count === 1 ? 'שובר אחד ששולם לא נמסר לנמען/ת' : `${count} שוברים ששולמו לא נמסרו לנמענים`}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            הכסף נגבה אך המייל לא יצא. אם כולם נכשלו באותה שגיאה, הבעיה היא כנראה בספק המייל (SendGrid) — תקנו אותה
            ואז שלחו מחדש.
          </p>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canResend && count > 0 && (
          <Button onClick={resendAll} disabled={pending} variant="destructive" size="sm">
            {pending ? 'שולח…' : 'שליחה חוזרת לכל השוברים שלא נמסרו'}
          </Button>
        )}
        <Link href="/admin/gift-cards" className="text-sm font-semibold text-primary hover:underline">
          לרשימת השוברים ←
        </Link>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-destructive'}`}>{msg.text}</p>}
      {rejected.length > 0 && (
        <div className="mt-2 text-sm">
          <div>שרת הנמען דחה את השוברים האלה — יש לתקן את כתובת הנמען/ת ורק אז לשלוח:</div>
          <ul className="mt-1 list-disc ps-5">
            {rejected.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/gift-cards/${r.id}`} className="text-primary hover:underline">
                  {r.code}
                </Link>{' '}
                · <span dir="ltr">{r.recipientEmail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
