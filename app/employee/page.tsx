import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { logoutEmployee } from '@/app/employee/actions'
import { getSettings } from '@/lib/gift-cards/service'
import { RedemptionConsole } from '@/components/employee/redemption-console'
import { Logo } from '@/components/site/logo'
import { Button } from '@/components/ui/button'
import { hasPermission } from '@/lib/permissions/roles'
import { ROLE_LABEL_HE } from '@/lib/permissions/roles'

export const dynamic = 'force-dynamic'

export default async function EmployeePage() {
  const user = await requireRole(['owner', 'admin', 'store_manager', 'store_employee'])
  const settings = await getSettings()
  const canAdmin = hasPermission(user.role, 'giftcard:suspend') || hasPermission(user.role, 'settings:manage')

  return (
    <main className="min-h-screen bg-muted/20">
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.name} · {ROLE_LABEL_HE[user.role]}
            </span>
            {canAdmin && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin">ניהול</Link>
              </Button>
            )}
            <form action={logoutEmployee}>
              <Button variant="outline" size="sm" type="submit">
                יציאה
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="container max-w-lg py-8">
        <h1 className="mb-1 text-2xl">מסך פדיון</h1>
        <p className="mb-6 text-sm text-muted-foreground">סרקו QR או הזינו קוד לפדיון שובר בחנות.</p>
        <RedemptionConsole allowPartial={settings.allowPartialRedemption} />
      </div>
    </main>
  )
}
