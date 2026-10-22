import { z } from 'zod'
import { actorFor, actorSchema, gate, json } from '@/lib/integration/route'
import { getStore } from '@/lib/data'
import { editRecipient } from '@/lib/gift-cards/recipient'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const body = z.object({
  actor: actorSchema,
  reason: z.string().trim().min(3).max(500),
  resend: z.boolean().default(false),
  fields: z.object({ recipientName: z.string().max(120).optional(), recipientEmail: z.string().max(200).optional(), recipientPhone: z.string().max(30).optional() }).strict(),
})

/**
 * POST /api/integration/v1/cards/:id/recipient — the same edit-and-resend as
 * /admin's "עריכת פרטי נמען/ת" (lib/gift-cards/recipient.ts), same validation.
 * A validation failure is 422 with the Hebrew message /admin would show.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = gate(request)
  if (denied) return denied
  if (!z.string().uuid().safeParse(params.id).success) return json({ error: 'invalid id' }, 400)
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
  try {
    if (!(await getStore().getGiftCardById(params.id))) return json({ error: 'card not found' }, 404)
    const { actor, reason, resend, fields } = parsed.data
    const res = await editRecipient(params.id, fields, actorFor(actor, reason), { resend })
    return json({ ok: res.ok, resent: res.resent ?? false, message: res.message ?? null }, res.ok ? 200 : 422)
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/cards/[id]/recipient' })
    return json({ error: 'update failed' }, 500)
  }
}
