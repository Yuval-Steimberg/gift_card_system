import { z } from 'zod'
import { actorFor, actorSchema, gate, json } from '@/lib/integration/route'
import { getStore } from '@/lib/data'
import { resendAllUndelivered } from '@/lib/gift-cards/service'
import { maskCode } from '@/lib/integration/cards'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const body = z.object({ actor: actorSchema })

/**
 * POST /api/integration/v1/delivery/resend-undelivered — /admin's
 * "שליחה חוזרת לכל השוברים שלא נמסרו". Cards the recipient's server rejected
 * are listed back (masked), not resent: they need a recipient edit first.
 */
export async function POST(request: Request) {
  const denied = gate(request)
  if (denied) return denied
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  try {
    const res = await resendAllUndelivered()
    await getStore().appendAudit({
      ...actorFor(parsed.data.actor, `resent ${res.delivered}/${res.queued}`),
      action: 'delivery.resend_all',
      entityType: 'system',
      entityId: 'delivery',
      metadata: { queued: res.queued, delivered: res.delivered, rejected: res.rejected.length, via: 'command_center' },
    })
    return json({ queued: res.queued, delivered: res.delivered, rejected: res.rejected.map((r) => ({ id: r.id, maskedCode: maskCode(r.code), recipientEmail: r.recipientEmail })) })
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/delivery/resend-undelivered' })
    return json({ error: 'resend failed' }, 500)
  }
}
