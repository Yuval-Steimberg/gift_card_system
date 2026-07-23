import Link from 'next/link'
import { Logo } from './logo'
import { Button } from '@/components/ui/button'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" aria-label="Just A Second — דף הבית">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/#how">איך זה עובד</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/gift-cards">רכישת שובר</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
