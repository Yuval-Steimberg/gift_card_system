import { NextResponse } from 'next/server'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Payment provider webhook. This is the ONLY thing that activates a gift card.
 * The request is signature-verified inside handlePaymentWebhook before any
 * state changes; a browser redirect is never treated as proof of payment.
 */
export async function POST(request: Request) {
  const outcome = await handlePaymentWebhook(request)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
