import { z } from 'zod'
import { gate, json } from '@/lib/integration/route'
import { searchCards } from '@/lib/integration/cards'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['draft', 'awaiting_payment', 'payment_processing', 'active', 'partially_redeemed', 'fully_redeemed', 'expired', 'suspended', 'cancelled', 'refunded', 'reissued', 'failed'] as const
const query = z.object({
  q: z.string().max(100).default(''),
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

/** GET /api/integration/v1/cards?q=&status=&limit=&offset= — search cards (masked codes). */
export async function GET(request: Request) {
  const denied = gate(request)
  if (denied) return denied
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = query.safeParse(params)
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid query' }, 400)
  try {
    return json(await searchCards(parsed.data.q, parsed.data))
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/cards' })
    return json({ error: 'search failed' }, 500)
  }
}
