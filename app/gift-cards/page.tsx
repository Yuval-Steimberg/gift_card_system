import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { PurchaseWizard } from '@/components/checkout/purchase-wizard'
import { getSettings } from '@/lib/gift-cards/service'
import { getStore } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function GiftCardsPage() {
  const store = getStore()
  const [settings, templates] = await Promise.all([getSettings(), store.listTemplates()])
  return (
    <>
      <SiteHeader />
      <main className="container py-10 md:py-14">
        <header className="mb-8 max-w-xl">
          <p className="eyebrow">רכישת שובר מתנה</p>
          <h1 className="mt-2 text-3xl">שובר מתנה דיגיטלי</h1>
          <p className="mt-2 text-muted-foreground">כמה שלבים קצרים — ואנחנו שולחים את המתנה לנמען.</p>
        </header>
        <PurchaseWizard templates={templates} settings={settings} />
      </main>
      <SiteFooter />
    </>
  )
}
