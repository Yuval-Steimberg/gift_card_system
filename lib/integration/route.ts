import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { integrationKeyOk, MIN_INTEGRATION_KEY_LENGTH } from '@/lib/integration/summary'

const NO_STORE = { 'Cache-Control': 'no-store' }
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

/**
 * Same gate as /api/integration/v1/summary: 404 while INTEGRATION_API_KEY is
 * unset or short, 401 for a wrong key. Returns a response to send, or null.
 */
export function gate(request: Request): NextResponse | null {
  const key = process.env.INTEGRATION_API_KEY
  if (!key || key.trim().length < MIN_INTEGRATION_KEY_LENGTH) return json({ error: 'not found' }, 404)
  if (!integrationKeyOk(request.headers.get('authorization'), key)) return json({ error: 'unauthorized' }, 401)
  return null
}

/**
 * Who in the command center asked for a write. The command center has already
 * checked their role; this is recorded in our own audit log so a change made
 * from there is never anonymous here.
 */
export const actorSchema = z.object({ email: z.string().email().max(200), role: z.string().min(1).max(40) })
export type IntegrationActor = z.infer<typeof actorSchema>

export const actorFor = (a: IntegrationActor, reason: string) => ({
  actorId: null,
  actorRole: 'command_center',
  reason: `${reason} — via JAS Command Center by ${a.email} (${a.role})`,
})
