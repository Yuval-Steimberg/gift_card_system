'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  adminAdjust,
  adminAddNote,
  adminCancel,
  adminReactivate,
  adminRefund,
  adminReissue,
  adminResend,
  adminSuspend,
} from '@/app/admin/actions'

export interface ActionPerms {
  resend: boolean
  suspend: boolean
  cancel: boolean
  refund: boolean
  reissue: boolean
  adjust: boolean
  note: boolean
}

export function CardActions({ id, status, perms }: { id: string; status: string; perms: ActionPerms }) {
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, successText: string) => {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg({ ok: res.ok, text: res.ok ? successText : res.message ?? 'שגיאה' })
      if (res.ok) {
        setOpen(null)
        setReason('')
        setAmount('')
        setNote('')
      }
    })
  }

  const isLive = status === 'active' || status === 'partially_redeemed'
  const isSuspended = status === 'suspended'

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-md p-3 text-sm ${msg.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {perms.resend && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => adminResend(id), 'נשלח מחדש')}>
            שליחה מחדש
          </Button>
        )}
        {perms.suspend && isLive && <Toggle label="השהיה" onClick={() => setOpen(open === 'suspend' ? null : 'suspend')} />}
        {perms.suspend && isSuspended && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => adminReactivate(id, 'הפעלה מחדש'), 'הופעל')}>
            הפעלה מחדש
          </Button>
        )}
        {perms.cancel && isLive && <Toggle label="ביטול" onClick={() => setOpen(open === 'cancel' ? null : 'cancel')} />}
        {perms.refund && isLive && <Toggle label="החזר כספי" onClick={() => setOpen(open === 'refund' ? null : 'refund')} />}
        {perms.reissue && <Toggle label="הנפקה מחדש" onClick={() => setOpen(open === 'reissue' ? null : 'reissue')} />}
        {perms.adjust && <Toggle label="התאמת יתרה" onClick={() => setOpen(open === 'adjust' ? null : 'adjust')} />}
        {perms.note && <Toggle label="הוספת הערה" onClick={() => setOpen(open === 'note' ? null : 'note')} />}
      </div>

      {open && open !== 'adjust' && open !== 'note' && (
        <ReasonBox
          reason={reason}
          setReason={setReason}
          pending={pending}
          onConfirm={() => {
            if (open === 'suspend') run(() => adminSuspend(id, reason), 'הושהה')
            if (open === 'cancel') run(() => adminCancel(id, reason), 'בוטל')
            if (open === 'refund') run(() => adminRefund(id, reason), 'הוחזר')
            if (open === 'reissue') run(() => adminReissue(id, reason), 'הונפק מחדש')
          }}
        />
      )}

      {open === 'adjust' && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex gap-2">
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              <option value="increase">הגדלה</option>
              <option value="decrease">הקטנה</option>
            </select>
            <Input dir="ltr" placeholder="סכום ₪" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
          </div>
          <Input placeholder="סיבה (חובה)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" />
          <Button size="sm" disabled={pending} onClick={() => run(() => adminAdjust(id, direction, amount, reason), 'היתרה עודכנה')}>
            אישור התאמה
          </Button>
        </div>
      )}

      {open === 'note' && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Textarea placeholder="הערה פנימית" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={pending} onClick={() => run(() => adminAddNote(id, note), 'ההערה נוספה')}>
            שמירת הערה
          </Button>
        </div>
      )}
    </div>
  )
}

function Toggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      {label}
    </Button>
  )
}

function ReasonBox({
  reason,
  setReason,
  onConfirm,
  pending,
}: {
  reason: string
  setReason: (v: string) => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <Input placeholder="סיבה (חובה, נשמר ביומן הביקורת)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" />
      <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={onConfirm}>
        אישור
      </Button>
    </div>
  )
}
