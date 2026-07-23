import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { Confirmation } from '@/components/checkout/confirmation'

export const dynamic = 'force-dynamic'

export default function ConfirmationPage({ searchParams }: { searchParams: { ref?: string } }) {
  if (!searchParams.ref) notFound()
  return (
    <>
      <SiteHeader />
      <main className="container flex min-h-[60vh] items-center py-16">
        <Confirmation giftCardId={searchParams.ref} />
      </main>
      <SiteFooter />
    </>
  )
}
