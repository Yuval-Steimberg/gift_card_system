import { redirect } from 'next/navigation'
import { Logo } from '@/components/site/logo'
import { LoginForm } from '@/components/employee/login-form'
import { getCurrentUser } from '@/lib/auth/session'
import { DEMO_PASSWORD } from '@/lib/auth/users'

export const dynamic = 'force-dynamic'

export default async function EmployeeLoginPage() {
  const user = await getCurrentUser()
  if (user) redirect('/employee')
  const showDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="justify-center" />
          <h1 className="mt-4 text-2xl">כניסת צוות</h1>
          <p className="mt-1 text-sm text-muted-foreground">מסך פדיון ומערכת הניהול</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-jas-2">
          <LoginForm />
        </div>
        {showDemo && (
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-semibold">חשבונות דמו (סיסמה: {DEMO_PASSWORD})</p>
            <ul className="mt-1 space-y-0.5" dir="ltr">
              <li>owner@justasecond.example — Owner</li>
              <li>manager@justasecond.example — Store manager</li>
              <li>employee1@justasecond.example — Store employee</li>
              <li>finance@justasecond.example — Finance</li>
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
