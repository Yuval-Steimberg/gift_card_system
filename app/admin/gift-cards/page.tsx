import Link from 'next/link'
import { getStore } from '@/lib/data'
import { formatMoney } from '@/lib/money'
import { StatusBadge } from '@/components/admin/status-badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { STATUS_LABEL_HE } from '@/lib/gift-cards/status'
import type { GiftCardStatus } from '@/lib/gift-cards/types'

export const dynamic = 'force-dynamic'

const STATUSES: GiftCardStatus[] = [
  'active',
  'partially_redeemed',
  'fully_redeemed',
  'suspended',
  'expired',
  'cancelled',
  'refunded',
]

export default async function GiftCardsAdminPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string }
}) {
  const status = STATUSES.includes(searchParams.status as GiftCardStatus)
    ? (searchParams.status as GiftCardStatus)
    : undefined
  const { items, total } = await getStore().listGiftCards({
    query: searchParams.q,
    status,
    limit: 100,
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl">שוברים</h1>
        <span className="text-sm text-muted-foreground">{total} תוצאות</span>
      </div>

      <form className="mb-4 flex flex-wrap gap-2" action="/admin/gift-cards" method="get">
        <Input name="q" placeholder="קוד, שם, אימייל, טלפון…" defaultValue={searchParams.q ?? ''} className="max-w-xs" />
        <select
          name="status"
          defaultValue={searchParams.status ?? ''}
          className="h-11 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">כל הסטטוסים</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL_HE[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          סינון
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-start">
            <tr className="text-start text-muted-foreground">
              <th className="p-3 text-start font-medium">קוד</th>
              <th className="p-3 text-start font-medium">נמען/ת</th>
              <th className="p-3 text-start font-medium">סטטוס</th>
              <th className="p-3 text-start font-medium">יתרה</th>
              <th className="p-3 text-start font-medium">ערך</th>
              <th className="p-3 text-start font-medium">נוצר</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="whitespace-nowrap p-3">
                  <Link href={`/admin/gift-cards/${c.id}`} className="font-mono text-primary hover:underline" dir="ltr">
                    {c.code}
                  </Link>
                </td>
                <td className="whitespace-nowrap p-3">{c.recipientName}</td>
                <td className="p-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="whitespace-nowrap p-3" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                  {formatMoney(c.balanceMinor, c.currency)}
                </td>
                <td className="whitespace-nowrap p-3 text-muted-foreground" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                  {formatMoney(c.initialAmountMinor, c.currency)}
                </td>
                <td className="whitespace-nowrap p-3 text-muted-foreground" dir="ltr">
                  {c.createdAt.slice(0, 10)}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  לא נמצאו שוברים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
