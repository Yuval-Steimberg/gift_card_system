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

export default async function EmployeePage({ searchParams }: { searchParams?: { code?: string } }) {
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
        {/* ?code= = a card scanned elsewhere (the JAS team portal's scan button): looked up on open, never redeemed by itself. */}
        <RedemptionConsole
          allowPartial={settings.allowPartialRedemption}
          initialCode={typeof searchParams?.code === 'string' ? searchParams.code.trim().slice(0, 300) : ''}
        />
      </div>
    </main>
  )
}
