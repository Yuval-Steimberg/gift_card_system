import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { getStore } from '@/lib/data'
import { parseEmailEvents } from '@/lib/delivery/email/events'
import {
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  verifySendGridSignature,
} from '@/lib/security/sendgrid-signature'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SendGrid Event Webhook receiver.
 *
 * WHY: `send()` returning 202 means SendGrid ACCEPTED the message — not that
 * anyone received it. Bounces, blocks and spam drops are reported only here,
 * after the fact. Without this endpoint a receiving mail server silently
 * discarding every card is indistinguishable from success, and the first person
 * to notice is the customer.
 *
 * Auth: when SENDGRID_WEBHOOK_PUBLIC_KEY is set we require SendGrid's ECDSA
 * signature (enable "Signed Event Webhook" in SendGrid). When it is NOT set we
 * accept the POST — telemetry that only ever marks our own delivery jobs is far
 * less dangerous than having no visibility at all, which is the state this
 * endpoint exists to end. Set the key.
 */
export async function POST(request: Request) {
  const env = serverEnv()
  const rawBody = await request.text()

  const publicKey = env.SENDGRID_WEBHOOK_PUBLIC_KEY?.trim()
  if (publicKey) {
    const result = verifySendGridSignature({
      publicKeyBase64: publicKey,
      signatureBase64: request.headers.get(SENDGRID_SIGNATURE_HEADER),
      timestamp: request.headers.get(SENDGRID_TIMESTAMP_HEADER),
      rawBody,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 401 })
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // Never 4xx on a payload we simply failed to read — SendGrid disables a
    // webhook that keeps erroring, and then we are blind again.
    return NextResponse.json({ ok: true, received: 0 })
  }

  const events = parseEmailEvents(payload)
  try {
    const { applied, unmatched } = await getStore().applyEmailProviderEvents('sendgrid', events)
    return NextResponse.json({ ok: true, received: events.length, applied, unmatched })
  } catch (err) {
    await reportError(err, { scope: 'email_event_webhook', events: events.length })
    // 500 so SendGrid retries rather than dropping real bounce data.
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
