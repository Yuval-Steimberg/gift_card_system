import { notFound } from 'next/navigation'
import { MockCheckout } from '@/components/checkout/mock-checkout'

export const dynamic = 'force-dynamic'

/**
 * Mock hosted checkout (dev only). Stands in for the provider's payment page.
 * "Approve" posts a signed webhook through the real verification path.
 */
export default function MockCheckoutPage({
  searchParams,
}: {
  searchParams: { cs?: string; ref?: string; amount?: string }
}) {
  const { cs, ref, amount } = searchParams
  if (!cs || !ref || !amount) notFound()
  const amountMinor = Number(amount)
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) notFound()
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <MockCheckout checkoutId={cs} giftCardId={ref} amountMinor={amountMinor} />
    </main>
  )
}
