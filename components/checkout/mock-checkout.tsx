'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/icons'
import { formatMoney } from '@/lib/money'
import { completeMockPayment } from '@/app/actions/purchase'

export function MockCheckout({
  checkoutId,
  giftCardId,
  amountMinor,
}: {
  checkoutId: string
  giftCardId: string
  amountMinor: number
}) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)

  async function act(approve: boolean) {
    setBusy(approve ? 'approve' : 'decline')
    const res = await completeMockPayment({ checkoutId, giftCardId, amountMinor, approve })
    window.location.href = res.redirectTo
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 shadow-jas-2">
      <div className="rounded-md bg-warning/15 px-3 py-2 text-center text-xs font-semibold text-warning">
        סביבת תשלום לפיתוח (Mock) — לא מתבצע חיוב אמיתי
      </div>
      <h1 className="mt-6 text-center text-2xl">אישור תשלום</h1>
      <p className="mt-2 text-center text-muted-foreground">
        סכום לתשלום:{' '}
        <strong dir="ltr" style={{ unicodeBidi: 'embed' }}>
          {formatMoney(amountMinor)}
        </strong>
      </p>
      <div className="mt-8 space-y-3">
        <Button className="w-full" size="lg" onClick={() => act(true)} disabled={busy !== null}>
          {busy === 'approve' ? <Loader className="h-4 w-4" /> : null}
          אישור ותשלום
        </Button>
        <Button className="w-full" variant="outline" size="lg" onClick={() => act(false)} disabled={busy !== null}>
          ביטול
        </Button>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        בסביבת הייצור תוחלף בעמוד התשלום המאובטח של הספק. השובר מונפק רק לאחר webhook מאומת.
      </p>
    </div>
  )
}
