import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getStore } from '@/lib/data'
import { requireRole } from '@/lib/auth/guards'
import { hasPermission } from '@/lib/permissions/roles'
import { formatMoney } from '@/lib/money'
import { serverEnv } from '@/lib/env'
import { recipientUrl } from '@/lib/gift-cards/qr'
import { StatusBadge } from '@/components/admin/status-badge'
import { CardActions, type ActionPerms } from '@/components/admin/card-actions'
import { ReverseRedemption } from '@/components/admin/reverse-redemption'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function CardDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['owner', 'admin', 'store_manager', 'finance', 'read_only'], '/employee/login')
  const store = getStore()
  const card = await store.getGiftCardById(params.id)
  if (!card) notFound()

  const [ledger, redemptions, audit, notes, jobs, template, payment] = await Promise.all([
    store.getLedger(card.id),
    store.getRedemptions(card.id),
    store.getAudit('gift_card', card.id),
    store.getNotes(card.id),
    store.getDeliveryJobs(card.id),
    store.getTemplate(card.templateId),
    store.getPaymentByGiftCard(card.id),
  ])

  const perms: ActionPerms = {
    resend: hasPermission(user.role, 'giftcard:resend'),
    suspend: hasPermission(user.role, 'giftcard:suspend'),
    cancel: hasPermission(user.role, 'giftcard:cancel'),
    refund: hasPermission(user.role, 'giftcard:refund'),
    reissue: hasPermission(user.role, 'giftcard:reissue'),
    adjust: hasPermission(user.role, 'giftcard:adjust_balance'),
    note: hasPermission(user.role, 'giftcard:add_note'),
  }
  const canReverse = hasPermission(user.role, 'redemption:reverse')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/gift-cards" className="text-sm text-muted-foreground hover:underline">
            ← חזרה לרשימה
          </Link>
          <h1 className="mt-1 font-mono text-2xl" dir="ltr">
            {card.code}
          </h1>
        </div>
        <StatusBadge status={card.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">יתרה</div>
          <div className="text-2xl font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
            {formatMoney(card.balanceMinor, card.currency)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">ערך מקורי</div>
          <div className="text-2xl font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
            {formatMoney(card.initialAmountMinor, card.currency)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">קישור ציבורי</div>
          <a href={recipientUrl(serverEnv().APP_BASE_URL, card.publicToken)} target="_blank" rel="noopener" className="text-sm text-primary hover:underline" dir="ltr">
            /gift/{card.publicToken.slice(0, 12)}…
          </a>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>פעולות</CardTitle>
        </CardHeader>
        <CardContent>
          <CardActions id={card.id} status={card.status} perms={perms} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>פרטים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="נמען/ת" v={card.recipientName} />
            <Row k="אימייל נמען/ת" v={card.recipientEmail} ltr />
            <Row k="רוכש/ת" v={card.isAnonymous ? 'אנונימי' : (card.buyerName ?? '—')} />
            <Row k="אימייל רוכש/ת" v={card.buyerEmail} ltr />
            <Row k="עיצוב" v={template?.name ?? card.templateId} />
            <Row k="תשלום" v={payment ? `${payment.provider} · ${payment.status}` : '—'} />
            <Row k="חשבונית עסקית" v={card.wantsInvoice ? 'כן' : 'לא'} />
            <Row k="פקיעה" v={card.expiresAt ? card.expiresAt.slice(0, 10) : 'ללא'} ltr />
            {card.greeting && <Row k="ברכה" v={card.greeting} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>משלוחים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {jobs.length === 0 && <p className="text-muted-foreground">אין רשומות משלוח</p>}
            {jobs.map((j) => (
              <div key={j.id} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                <span>{j.channel}</span>
                <span className="text-muted-foreground">
                  {j.status} · ניסיונות {j.attempts}
                  {j.lastError ? ` · ${j.lastError}` : ''}
                </span>
              </div>
            ))}
            {notes.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-1 font-semibold">הערות פנימיות</div>
                {notes.map((n) => (
                  <p key={n.id} className="text-muted-foreground">
                    · {n.body}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ספר תנועות (Ledger)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-muted-foreground">
              <tr>
                <th className="p-2 text-start font-medium">סוג</th>
                <th className="p-2 text-start font-medium">סכום</th>
                <th className="p-2 text-start font-medium">יתרה אחרי</th>
                <th className="p-2 text-start font-medium">סיבה</th>
                <th className="p-2 text-start font-medium">תאריך</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-t border-border/50">
                  <td className="p-2 font-mono text-xs">{e.type}</td>
                  <td className="p-2" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {formatMoney(Math.abs(e.amountMinor), e.currency)}
                    {e.amountMinor < 0 ? '−' : '+'}
                  </td>
                  <td className="p-2" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {formatMoney(e.balanceAfterMinor, e.currency)}
                  </td>
                  <td className="p-2 text-muted-foreground">{e.reason ?? '—'}</td>
                  <td className="p-2 text-muted-foreground" dir="ltr">
                    {e.createdAt.slice(0, 16).replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>פדיונות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {redemptions.length === 0 && <p className="text-sm text-muted-foreground">אין פדיונות</p>}
          {redemptions.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex justify-between">
                <span dir="ltr" style={{ unicodeBidi: 'embed' }} className="font-bold">
                  {formatMoney(r.amountMinor)}
                </span>
                <span className="text-muted-foreground" dir="ltr">
                  {r.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
              </div>
              <div className="text-muted-foreground">
                יתרה: {formatMoney(r.balanceBeforeMinor)} ← {formatMoney(r.balanceAfterMinor)}
                {r.reversedByReversalId ? ' · בוטל' : ''}
              </div>
              {canReverse && !r.reversedByReversalId && <ReverseRedemption giftCardId={card.id} redemptionId={r.id} />}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>יומן ביקורת</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {audit.map((a) => (
            <div key={a.id} className="flex justify-between border-b border-border/50 py-1 last:border-0">
              <span>
                <span className="font-mono text-xs">{a.action}</span>
                {a.reason ? <span className="text-muted-foreground"> · {a.reason}</span> : null}
              </span>
              <span className="text-muted-foreground" dir="ltr">
                {a.createdAt.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-end font-medium" dir={ltr ? 'ltr' : undefined} style={ltr ? { unicodeBidi: 'embed' } : undefined}>
        {v}
      </span>
    </div>
  )
}
