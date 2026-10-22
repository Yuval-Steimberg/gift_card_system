import { z } from 'zod'
import { gate, json } from '@/lib/integration/route'
import { buildIntegrationSales, daysBetween, MAX_RANGE_DAYS } from '@/lib/integration/sales'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)), 'not a date')
const query = z
  .object({ from: day, to: day })
  .refine((q) => daysBetween(q.from, q.to) >= 0, 'from is after to')
  .refine((q) => daysBetween(q.from, q.to) < MAX_RANGE_DAYS, `at most ${MAX_RANGE_DAYS} days`)

/**
 * GET /api/integration/v1/sales?from=YYYY-MM-DD&to=YYYY-MM-DD — daily sales and
 * redemptions (Israel days) for the range and the equally long period before
 * it. Same key gate as the summary; counts and agorot only.
 */
export async function GET(request: Request) {
  const denied = gate(request)
  if (denied) return denied
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid query' }, 400)
  try {
    return json(await buildIntegrationSales(parsed.data.from, parsed.data.to))
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/sales' })
    return json({ error: 'sales failed' }, 500)
  }
}
