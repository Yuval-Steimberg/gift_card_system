import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { logoutEmployee } from '@/app/employee/actions'
import { Logo } from '@/components/site/logo'
import { Button } from '@/components/ui/button'
import { ROLE_LABEL_HE } from '@/lib/permissions/roles'
import { LayoutDashboard, Gift, CreditCard } from '@/components/icons'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/admin', label: 'סקירה', icon: LayoutDashboard },
  { href: '/admin/gift-cards', label: 'שוברים', icon: Gift },
  { href: '/admin/reports', label: 'דוחות', icon: CreditCard },
  { href: '/admin/templates', label: 'עיצובים', icon: Gift },
  { href: '/admin/settings', label: 'הגדרות', icon: LayoutDashboard },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['owner', 'admin', 'store_manager', 'finance', 'read_only'], '/employee/login')
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Logo />
            <span className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
              מערכת ניהול
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.name} · {ROLE_LABEL_HE[user.role]}
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href="/employee">מסך פדיון</Link>
            </Button>
            <form action={logoutEmployee}>
              <Button variant="outline" size="sm" type="submit">
                יציאה
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="container flex gap-8 py-8">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="sticky top-8 space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
