import Link from 'next/link'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { Button } from '@/components/ui/button'

export default function CancelledPage() {
  return (
    <>
      <SiteHeader />
      <main className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <h1 className="text-3xl">התשלום לא הושלם</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          לא בוצע חיוב. אפשר לנסות שוב בכל רגע — הפרטים שמילאת לא נשמרו.
        </p>
        <Button asChild className="mt-6">
          <Link href="/gift-cards">חזרה לרכישה</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  )
}
