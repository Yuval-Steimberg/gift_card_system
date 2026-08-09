import Link from 'next/link'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { Button } from '@/components/ui/button'
import { GiftCardPreview } from '@/components/gift-card/gift-card-preview'
import { ImpactNote } from '@/components/site/impact-note'
import { getSettings } from '@/lib/gift-cards/service'
import { formatMoney } from '@/lib/money'
import { CreditCard, Gift, Mail, ShieldCheck } from '@/components/icons'

// Reads live settings at request time; do not prerender at build.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const settings = await getSettings()
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="container grid gap-10 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div className="space-y-6">
            <p className="eyebrow">שוברי מתנה</p>
            <h1 className="text-4xl leading-tight md:text-5xl">
              <span className="font-display block text-3xl md:text-4xl">Just a Second</span>
              <span className="mt-2 block font-extrabold">מתנה עם סיפור, מתנה עם משמעות.</span>
            </h1>
            <div className="max-w-md space-y-4 text-lg text-muted-foreground">
              <p>הזדמנות לרכוש שובר מתנה ייחודי.</p>
              <div className="text-base">
                <p className="font-semibold text-foreground">שימו לב:</p>
                <ul className="mt-1 list-disc space-y-1 ps-5">
                  <li>השובר ניתן למימוש רק בחנות הפיזית שלנו. לא ניתן למימוש בחנות המקוונת.</li>
                  <li>תוקף השובר לארבעה חודשים.</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/gift-cards">רכישת שובר מתנה</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/#how">איך זה עובד</Link>
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">נפדה במנחם בגין 34, תל אביב</p>
              <ImpactNote />
            </div>
          </div>
          <div className="mx-auto w-full max-w-md">
            <GiftCardPreview
              template={{ backgroundColor: '#333D36', textColor: '#FFFCF5', accentColor: '#E88225', name: '' }}
              amountMinor={settings.presetAmountsMinor[1] ?? 20000}
              recipientName="יעל"
              senderName="דנה"
              greeting={'חשבתי עלייך.\nבחרי לך משהו יפה מהחנות שלהם.'}
              code="JAS-••••-••••"
            />
          </div>
        </section>

        {/* Presets */}
        <section className="container pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">סכומים פופולריים:</span>
            {settings.presetAmountsMinor.map((a) => (
              <span key={a} className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold" dir="ltr">
                {formatMoney(a, settings.currency)}
              </span>
            ))}
            <span className="text-sm text-muted-foreground">או סכום חופשי</span>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="container py-16">
          <h2 className="text-3xl">איך זה עובד</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-4">
            {[
              { icon: Gift, title: 'בוחרים', body: 'סכום, עיצוב וברכה אישית עם תצוגה מקדימה חיה.' },
              { icon: CreditCard, title: 'משלמים', body: 'תשלום מאובטח. השובר מונפק רק לאחר אישור תשלום.' },
              { icon: Mail, title: 'נשלח', body: 'הנמען מקבל קישור מאובטח, קוד ו-QR — מייד או במועד שתבחרו.' },
              { icon: ShieldCheck, title: 'נפדה', body: 'פדיון בחנות, מלא או חלקי, עם הגנה מפני שימוש כפול.' },
            ].map((step) => (
              <div key={step.title} className="rounded-lg border border-border bg-card p-6 shadow-jas-1">
                <step.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 text-lg">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
