'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { reportGiftCardLost } from '@/app/gift/[token]/actions'

export function ReportLost({ token }: { token: string }) {
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="text-muted-foreground">
          איבדתי את השובר / חשד לשימוש לרעה
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>דיווח על שובר אבוד</DialogTitle>
          <DialogDescription>נעביר את הדיווח לצוות החנות לבדיקה והנפקה מחדש.</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="text-sm text-success">הדיווח התקבל. הצוות ייצור קשר לאימות פרטים.</p>
        ) : (
          <div className="space-y-3">
            <Textarea placeholder="פרטים (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await reportGiftCardLost(token, note)
                setDone(true)
                setBusy(false)
              }}
            >
              שליחת דיווח
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
