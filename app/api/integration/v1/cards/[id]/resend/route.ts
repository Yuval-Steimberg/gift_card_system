import { z } from 'zod'
import { actorFor, actorSchema, gate, json } from '@/lib/integration/route'
import { getStore } from '@/lib/data'
import { resendGiftCard } from '@/lib/gift-cards/service'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const body = z.object({ actor: actorSchema, reason: z.string().trim().min(3).max(500) })

/** POST /api/integration/v1/cards/:id/resend — the same resend as /admin, recorded in our audit log. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = gate(request)
  if (denied) return denied
  if (!z.string().uuid().safeParse(params.id).success) return json({ error: 'invalid id' }, 400)
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  const store = getStore()
  try {
    if (!(await store.getGiftCardById(params.id))) return json({ error: 'card not found' }, 404)
    const res = await resendGiftCard(params.id)
    const who = actorFor(parsed.data.actor, parsed.data.reason)
    await store.appendAudit({ ...who, action: 'giftcard.resend', entityType: 'gift_card', entityId: params.id, metadata: { sent: res.ok, via: 'command_center' } })
    return json({ ok: res.ok, message: res.message ?? null })
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/cards/[id]/resend' })
    return json({ error: 'resend failed' }, 500)
  }
}
