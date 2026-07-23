import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { hasPermission } from '@/lib/permissions/roles'
import { getStore } from '@/lib/data'
import { getAdminStats } from '@/lib/gift-cards/admin-service'
import { formatMoney } from '@/lib/money'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from '@/components/icons'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const user = await requireRole(['owner', 'admin', 'finance', 'read_only'], '/employee/login')
  const store = getStore()
  const [stats, templates, all] = await Promise.all([
    getAdminStats(),
    store.listTemplates(true),
    store.listGiftCards({ limit: 100000 }),
  ])
  const canExport = hasPermission(user.role, 'export:financial')

  const byTemplate = templates.map((t) => {
    const cards = all.items.filter((c) => c.templateId === t.id)
    return { name: t.name, count: cards.length, valueMinor: cards.reduce((s, c) => s + c.initialAmountMinor, 0) }
  })

  const redemptionRate =
    stats.totalSalesMinor > 0 ? Math.round((stats.redeemedMinor / stats.totalSalesMinor) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">דוחות</h1>
        {canExport && (
          <Button asChild variant="outline">
            <a href="/admin/reports/export?type=cards">
              <Download className="h-4 w-4" />
              ייצוא CSV
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">אחוז מימוש</div>
          <div className="text-2xl font-bold" dir="ltr">
            {redemptionRate}%
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">יתרה פתוחה</div>
          <div className="text-2xl font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
            {formatMoney(stats.outstandingMinor)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">נפדה סה״כ</div>
          <div className="text-2xl font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
            {formatMoney(stats.redeemedMinor)}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>מכירות לפי עיצוב</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-start text-muted-foreground">
              <tr>
                <th className="p-2 text-start font-medium">עיצוב</th>
                <th className="p-2 text-start font-medium">כמות</th>
                <th className="p-2 text-start font-medium">ערך</th>
              </tr>
            </thead>
            <tbody>
              {byTemplate.map((r) => (
                <tr key={r.name} className="border-t border-border/50">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">{r.count}</td>
                  <td className="p-2" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {formatMoney(r.valueMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {!canExport && (
        <p className="text-sm text-muted-foreground">
          ייצוא נתונים פיננסיים מוגבל להרשאת כספים. <Link href="/admin" className="underline">חזרה</Link>
        </p>
      )}
    </div>
  )
}
