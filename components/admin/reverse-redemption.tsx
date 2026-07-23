'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminReverseRedemption } from '@/app/admin/actions'

export function ReverseRedemption({ giftCardId, redemptionId }: { giftCardId: string; redemptionId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        ביטול פדיון
      </Button>
    )
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <Input placeholder="סיבה (חובה)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8" />
      {msg && <p className="text-xs text-destructive">{msg}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || reason.trim().length < 3}
          onClick={() =>
            start(async () => {
              const res = await adminReverseRedemption(giftCardId, redemptionId, reason)
              if (res.ok) setOpen(false)
              else setMsg(res.message ?? 'שגיאה')
            })
          }
        >
          אישור ביטול
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          חזרה
        </Button>
      </div>
    </div>
  )
}
