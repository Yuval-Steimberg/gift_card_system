import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { deliverDueJobs } from '@/lib/gift-cards/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Delivery worker. Processes due delivery jobs (immediate + scheduled). Meant to
 * be invoked by a scheduler (Vercel Cron / Supabase scheduled function / any
 * external cron) — NOT an in-process timer.
 *
 * Auth: when CRON_SECRET is configured we require `Authorization: Bearer <secret>`
 * (Vercel Cron sends exactly this automatically whenever a CRON_SECRET env var
 * exists) OR Vercel's own `x-vercel-cron` header. When CRON_SECRET is NOT set we
 * allow the call so scheduled delivery works out-of-the-box — the endpoint only
 * flushes already-due delivery emails and is fully idempotent (never charges,
 * never double-sends thanks to per-card idempotency keys). A misconfigured/empty
 * secret must therefore NEVER silently strand every scheduled card (the old
 * behavior: it 401'd and scheduled cards never delivered).
 */
export async function POST(request: Request) {
  const env = serverEnv()
  const secret = env.CRON_SECRET?.trim()
  if (secret) {
    const auth = request.headers.get('authorization')?.trim()
    const isVercelCron = request.headers.get('x-vercel-cron') != null
    if (auth !== `Bearer ${secret}` && !isVercelCron) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }
  const result = await deliverDueJobs(new Date().toISOString(), 50)
  return NextResponse.json({ ok: true, ...result })
}

// Allow GET for platforms that trigger crons via GET, still secret-gated.
export async function GET(request: Request) {
  return POST(request)
}
