'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { QrScanner } from './qr-scanner'
import { Loader, Search } from '@/components/icons'
import { parseMajorToMinor, formatMoney } from '@/lib/money'
import { lookupCard, performRedemption, type LookupResult, type RedeemResponse } from '@/app/employee/actions'

export function RedemptionConsole({ allowPartial }: { allowPartial: boolean }) {
  const [code, setCode] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [amount, setAmount] = useState('')
  const [saleRef, setSaleRef] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [result, setResult] = useState<RedeemResponse | null>(null)
  const [offline, setOffline] = useState(false)

  // `keepResult` is used by the post-redemption refresh: re-reading the card must
  // NOT wipe the "הפדיון בוצע בהצלחה · יתרה מעודכנת" banner the cashier just got.
  async function doLookup(value?: string, keepResult = false) {
    const q = (value ?? code).trim()
    if (!q) return
    if (value) setCode(value)
    setLooking(true)
    if (!keepResult) setResult(null)
    setLookup(null)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true)
      setLooking(false)
      return
    }
    setOffline(false)
    try {
      const res = await lookupCard(q)
      setLookup(res)
      if (res.card?.redeemable) setAmount(res.card.balanceLabel.replace(/[^\d.]/g, ''))
    } finally {
      setLooking(false)
    }
  }

  async function doRedeem() {
    if (!lookup?.card) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true)
      return
    }
    const amountMinor = parseMajorToMinor(amount)
    if (amountMinor == null || amountMinor <= 0) {
      setResult({ ok: false, code: 'invalid', message: 'סכום לא תקין' })
      return
    }
    if (amountMinor > lookup.card.balanceMinor) {
      setResult({ ok: false, code: 'insufficient_balance', message: 'הסכום גבוה מהיתרה' })
      return
    }
    setRedeeming(true)
    // Idempotency key generated ONCE per redemption attempt; a double-click
    // reuses it so the server never double-charges.
    const idempotencyKey = crypto.randomUUID()
    try {
      const res = await performRedemption({
        giftCardId: lookup.card.id,
        amountMinor,
        idempotencyKey,
        saleReference: saleRef || undefined,
      })
      setResult(res)
      if (res.ok) {
        // refresh card view, keeping the success banner visible
        await doLookup(lookup.card.code, true)
      }
    } finally {
      setRedeeming(false)
    }
  }

  const card = lookup?.card

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 shadow-jas-1">
        <Label htmlFor="code">קוד שובר או QR</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="code"
            dir="ltr"
            placeholder="JAS-XXXX-XXXX-X"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doLookup()}
            className="font-mono"
          />
          <Button onClick={() => doLookup()} disabled={looking || !code.trim()}>
            {looking ? <Loader className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            חיפוש
          </Button>
        </div>
        <div className="mt-3">
          <QrScanner onResult={(text) => doLookup(text)} />
        </div>
      </div>

      {offline && (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          אין חיבור לאינטרנט. אימות מקוון נדרש לפני כל פדיון — לא ניתן לממש כעת. הסכום שהוזן נשמר; נסו שוב כשהחיבור יחזור.
        </div>
      )}

      {lookup && !lookup.found && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {lookup.message ?? 'שובר לא נמצא'}
        </div>
      )}

      {card && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-jas-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm" dir="ltr">
                {card.code}
              </div>
              <div className="text-sm text-muted-foreground">{card.recipientName}</div>
            </div>
            <Badge variant={card.redeemable ? 'success' : 'destructive'}>{card.statusLabel}</Badge>
          </div>

          <div className="mt-4 flex items-baseline justify-between rounded-md bg-muted/50 px-4 py-3">
            <span className="text-sm text-muted-foreground">יתרה</span>
            <span className="text-2xl font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
              {card.balanceLabel}
            </span>
          </div>

          {card.redeemable ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="amount">סכום לפדיון</Label>
                <div className="flex gap-2">
                  <Input
                    id="amount"
                    dir="ltr"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="text-lg font-bold"
                  />
                  {allowPartial && (
                    <Button variant="outline" onClick={() => setAmount(card.balanceLabel.replace(/[^\d.]/g, ''))}>
                      מלא
                    </Button>
                  )}
                </div>
                {!allowPartial && <p className="text-xs text-muted-foreground">פדיון חלקי מושבת בהגדרות המערכת.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="saleref">אסמכתא / מספר מכירה (לא חובה)</Label>
                <Input id="saleref" dir="ltr" value={saleRef} onChange={(e) => setSaleRef(e.target.value)} />
              </div>
              <Button className="w-full" size="lg" onClick={doRedeem} disabled={redeeming}>
                {redeeming ? <Loader className="h-4 w-4" /> : null}
                אישור פדיון
              </Button>
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              לא ניתן לממש שובר במצב זה.
            </p>
          )}

          {result && (
            <div
              role="status"
              className={`mt-4 rounded-md p-4 text-sm ${
                result.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
              }`}
            >
              <div className="font-semibold">{result.message}</div>
              {result.balanceLabel && (
                <div className="mt-1">
                  יתרה מעודכנת:{' '}
                  <span dir="ltr" style={{ unicodeBidi: 'embed' }} className="font-bold">
                    {result.balanceLabel}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
