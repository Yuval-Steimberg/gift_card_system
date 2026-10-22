import { NextResponse } from 'next/server'
import { buildIntegrationSummary, integrationKeyOk, MIN_INTEGRATION_KEY_LENGTH } from '@/lib/integration/summary'
import { reportError } from '@/lib/logging/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/integration/v1/summary — read-only aggregates for the JAS Command
 * Center (server-to-server). Disabled (404) unless INTEGRATION_API_KEY is set
 * to 32+ characters; the caller sends `Authorization: Bearer <that key>`.
 * Counts and agorot only — see lib/integration/summary.ts.
 */
export async function GET(request: Request) {
  const key = process.env.INTEGRATION_API_KEY
  if (!key || key.trim().length < MIN_INTEGRATION_KEY_LENGTH) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!integrationKeyOk(request.headers.get('authorization'), key)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    return NextResponse.json(await buildIntegrationSummary(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    await reportError(e, { where: 'api/integration/v1/summary' })
    return NextResponse.json({ error: 'summary failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
