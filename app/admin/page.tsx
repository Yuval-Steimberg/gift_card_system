import Link from 'next/link'
import { getAdminStats } from '@/lib/gift-cards/admin-service'
import { formatMoney } from '@/lib/money'
import { Card } from '@/components/ui/card'

function Stat({ label, value, hint, ltr }: { label: string; value: string; hint?: string; ltr?: boolean }) {
  return (
    <Card className="p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold" dir={ltr ? 'ltr' : undefined} style={ltr ? { unicodeBidi: 'embed' } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export default async function AdminOverview() {
  const s = await getAdminStats()
  return (
    <div>
      <h1 className="mb-6 text-2xl">סקירה</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="מכירות סה״כ" value={formatMoney(s.totalSalesMinor)} ltr hint={`היום ${s.soldToday} · שבוע ${s.soldWeek} · חודש ${s.soldMonth}`} />
        <Stat label="יתרה פעילה (חוב פתוח)" value={formatMoney(s.outstandingMinor)} ltr />
        <Stat label="נפדה סה״כ" value={formatMoney(s.redeemedMinor)} ltr />
        <Stat label="שוברים פעילים" value={String(s.active)} />
        <Stat label="נוצלו חלקית" value={String(s.partiallyRedeemed)} />
        <Stat label="נוצלו במלואם" value={String(s.fullyRedeemed)} />
        <Stat label="מושהים" value={String(s.suspended)} />
        <Stat label="הוחזרו" value={String(s.refunded)} />
        <Stat label="לקראת פקיעה (30 יום)" value={String(s.expiringSoon)} />
        <Stat label="כשלי משלוח" value={String(s.failedDeliveries)} />
      </div>

      <div className="mt-8 flex gap-3">
        <Link href="/admin/gift-cards" className="text-sm font-semibold text-primary hover:underline">
          לניהול כל השוברים ←
        </Link>
      </div>
    </div>
  )
}
