'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  adminAdjust,
  adminAddNote,
  adminCancel,
  adminEditRecipient,
  adminMarkPaid,
  adminReactivate,
  adminRefund,
  adminReissue,
  adminResend,
  adminSuspend,
} from '@/app/admin/actions'
import { checkEmail } from '@/lib/validation/email'

export interface ActionPerms {
  resend: boolean
  editRecipient: boolean
  suspend: boolean
  cancel: boolean
  refund: boolean
  reissue: boolean
  adjust: boolean
  markPaid: boolean
  note: boolean
}

export interface RecipientDetails {
  name: string
  email: string
  phone: string | null
}

export function CardActions({
  id,
  status,
  perms,
  recipient,
}: {
  id: string
  status: string
  perms: ActionPerms
  recipient: RecipientDetails
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  // Recipient edit form, seeded from the card's current details.
  const [rName, setRName] = useState(recipient.name)
  const [rEmail, setREmail] = useState(recipient.email)
  const [rPhone, setRPhone] = useState(recipient.phone ?? '')
  const [resendAfter, setResendAfter] = useState(true)

  const emailChanged = rEmail.trim().toLowerCase() !== recipient.email.trim().toLowerCase()
  const emailCheck = checkEmail(rEmail)

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

  const saveRecipient = () => {
    setMsg(null)
    start(async () => {
      const res = await adminEditRecipient(
        id,
        { recipientName: rName, recipientEmail: rEmail, recipientPhone: rPhone },
        reason,
        { resend: resendAfter },
      )
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? 'שגיאה' })
        return
      }
      setMsg({
        ok: true,
        text: res.resent
          ? `הפרטים עודכנו והשובר נשלח ל-${rEmail.trim()}`
          : res.message ?? 'הפרטים עודכנו',
      })
      setOpen(null)
      setReason('')
    })
  }

  const isLive = status === 'active' || status === 'partially_redeemed'
  const isSuspended = status === 'suspended'
  const isPreActivation = ['draft', 'awaiting_payment', 'payment_processing', 'failed'].includes(status)

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-md p-3 text-sm ${msg.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {perms.markPaid && isPreActivation && (
          <Button size="sm" disabled={pending} onClick={() => setOpen(open === 'markPaid' ? null : 'markPaid')}>
            סימון כשולם והפעלה
          </Button>
        )}
        {perms.resend && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => adminResend(id), 'נשלח מחדש')}>
            שליחה מחדש
          </Button>
        )}
        {perms.editRecipient && <Toggle label="עריכת פרטי נמען/ת" onClick={() => setOpen(open === 'recipient' ? null : 'recipient')} />}
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

      {open === 'recipient' && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            לשימוש כשהשובר לא הגיע לנמען/ת — למשל כתובת שגויה או שרת דואר ארגוני שחוסם אותנו.
            &quot;שליחה מחדש&quot; לבדה תנסה שוב בדיוק את אותה הכתובת.
          </p>
          <label className="block text-sm">
            שם הנמען/ת
            <Input value={rName} onChange={(e) => setRName(e.target.value)} className="mt-1 h-9" />
          </label>
          <label className="block text-sm">
            אימייל הנמען/ת
            <Input dir="ltr" value={rEmail} onChange={(e) => setREmail(e.target.value)} className="mt-1 h-9" />
          </label>
          {rEmail.trim() && !emailCheck.ok && <p className="text-sm text-destructive">{emailCheck.error}</p>}
          <label className="block text-sm">
            טלפון הנמען/ת
            <Input dir="ltr" value={rPhone} onChange={(e) => setRPhone(e.target.value)} className="mt-1 h-9" />
          </label>
          <Input
            placeholder="סיבה (חובה, נשמר ביומן הביקורת)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={resendAfter} onChange={(e) => setResendAfter(e.target.checked)} />
            שליחת השובר מיד לאחר העדכון
            {emailChanged && <span className="text-muted-foreground">(הכתובת השתנתה)</span>}
          </label>
          <Button size="sm" disabled={pending || reason.trim().length < 3 || !emailCheck.ok} onClick={saveRecipient}>
            שמירה{resendAfter ? ' ושליחה' : ''}
          </Button>
        </div>
      )}

      {open && open !== 'adjust' && open !== 'note' && open !== 'recipient' && (
        <ReasonBox
          reason={reason}
          setReason={setReason}
          pending={pending}
          hint={
            open === 'markPaid'
              ? 'להשתמש רק לאחר אימות שהתשלום בוצע בפועל בלוח הבקרה של הספק. פעולה זו מפעילה את השובר, מזכה את היתרה ושולחת אותו לנמען.'
              : undefined
          }
          confirmLabel={open === 'markPaid' ? 'הפעלת השובר' : 'אישור'}
          onConfirm={() => {
            if (open === 'suspend') run(() => adminSuspend(id, reason), 'הושהה')
            if (open === 'cancel') run(() => adminCancel(id, reason), 'בוטל')
            if (open === 'refund') run(() => adminRefund(id, reason), 'הוחזר')
            if (open === 'reissue') run(() => adminReissue(id, reason), 'הונפק מחדש')
            if (open === 'markPaid') run(() => adminMarkPaid(id, reason), 'השובר הופעל')
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
  hint,
  confirmLabel = 'אישור',
}: {
  reason: string
  setReason: (v: string) => void
  onConfirm: () => void
  pending: boolean
  hint?: string
  confirmLabel?: string
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <Input placeholder="סיבה (חובה, נשמר ביומן הביקורת)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" />
      <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  )
}
