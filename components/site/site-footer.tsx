import Link from 'next/link'
import { Logo } from './logo'
import { ImpactNote } from './impact-note'

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-muted/40">
      <div className="container flex flex-col gap-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm space-y-3">
          <Logo />
          <p className="text-sm text-muted-foreground">
            ליצור שפע משפע. שוברי מתנה דיגיטליים לחנות Just A Second — מנחם בגין 34, תל אביב.
          </p>
          <ImpactNote />
        </div>
        <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
          <Link href="/gift-cards" className="hover:underline">
            רכישת שובר מתנה
          </Link>
          <Link href="/terms" className="hover:underline">
            תנאי שימוש
          </Link>
          <Link href="/privacy" className="hover:underline">
            מדיניות פרטיות
          </Link>
          <Link href="/employee" className="hover:underline">
            כניסת עובדים
          </Link>
        </nav>
      </div>
      <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Just A Second
      </div>
    </footer>
  )
}
