import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { Confirmation } from '@/components/checkout/confirmation'
import { getSettings } from '@/lib/gift-cards/service'

export const dynamic = 'force-dynamic'

export default async function ConfirmationPage({ searchParams }: { searchParams: { ref?: string } }) {
  if (!searchParams.ref) notFound()
  // Contact details come from live settings — never hardcoded in the page.
  const settings = await getSettings()
  return (
    <>
      <SiteHeader />
      <main className="container flex min-h-[60vh] items-center py-16">
        <Confirmation giftCardId={searchParams.ref} contactPhone={settings.businessPhone} />
      </main>
      <SiteFooter />
    </>
  )
}
