import { z } from 'zod'
import { gate, json } from '@/lib/integration/route'
import { cardDetail } from '@/lib/integration/cards'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/integration/v1/cards/:id — one card with delivery, ledger, redemptions and audit (masked code). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const denied = gate(request)
  if (denied) return denied
  if (!z.string().uuid().safeParse(params.id).success) return json({ error: 'invalid id' }, 400)
  try {
    const detail = await cardDetail(params.id)
    return detail ? json(detail) : json({ error: 'card not found' }, 404)
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/cards/[id]' })
    return json({ error: 'lookup failed' }, 500)
  }
}
