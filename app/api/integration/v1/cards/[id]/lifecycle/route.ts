import { z } from 'zod'
import { actorFor, actorSchema, gate, json } from '@/lib/integration/route'
import { getStore } from '@/lib/data'
import { adjustBalance, cancelCard, describeRefund, reactivateCard, refundCard, reissueCard, suspendCard } from '@/lib/gift-cards/admin-service'
import { markPaid } from '@/lib/gift-cards/mark-paid'
import { maskCode } from '@/lib/integration/cards'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const common = { actor: actorSchema, reason: z.string().trim().min(3).max(500) }
const body = z.discriminatedUnion('op', [
  z.object({ ...common, op: z.enum(['suspend', 'reactivate', 'cancel', 'refund', 'reissue', 'mark_paid']) }),
  z.object({
    ...common,
    op: z.literal('adjust'),
    direction: z.enum(['increase', 'decrease']),
    amountMinor: z.number().int().positive().max(10_000_000),
    // One confirmation = one adjustment, even if the request is sent twice.
    requestId: z.string().uuid(),
  }),
])

/**
 * POST /api/integration/v1/cards/:id/lifecycle — the money-moving /admin
 * actions (suspend, reactivate, cancel, refund, reissue, adjust balance, mark
 * paid), each calling the SAME function /admin calls. The command center has
 * already checked the person's role; the actor and reason land in our audit log.
 *
 * A refused change (illegal status transition, balance would go negative) is
 * 422 with the store's message. A reissue answers with the new card's id and
 * MASKED code only — the full code goes to the recipient, never to the console.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = gate(request)
  if (denied) return denied
  if (!z.string().uuid().safeParse(params.id).success) return json({ error: 'invalid id' }, 400)
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  const input = parsed.data
  const actor = actorFor(input.actor, input.reason)
  try {
    if (!(await getStore().getGiftCardById(params.id))) return json({ error: 'card not found' }, 404)
    let out: { ok: boolean; message?: string | null; [k: string]: unknown }
    switch (input.op) {
      case 'suspend':
        out = await suspendCard(params.id, actor)
        break
      case 'reactivate':
        out = await reactivateCard(params.id, actor)
        break
      case 'cancel':
        out = await cancelCard(params.id, actor)
        break
      case 'refund': {
        const r = await refundCard(params.id, actor)
        out = r.ok ? { ok: true, message: describeRefund(r.provider, r.refundedMinor), provider: r.provider, refundedMinor: r.refundedMinor } : r
        break
      }
      case 'reissue': {
        const r = await reissueCard(params.id, actor)
        out = { ok: r.ok, message: r.message, newCard: r.newCard ? { id: r.newCard.id, maskedCode: maskCode(r.newCard.code) } : null }
        break
      }
      case 'adjust':
        out = await adjustBalance(params.id, input.direction, input.amountMinor, actor, `cc:${input.requestId}`)
        break
      case 'mark_paid':
        out = await markPaid(params.id, actor)
        break
    }
    return json({ ...out, message: out.message ?? null }, out.ok ? 200 : 422)
  } catch (e) {
    await reportError(e, { where: `api/integration/v1/cards/[id]/lifecycle:${input.op}` })
    return json({ error: `${input.op} failed` }, 500)
  }
}
