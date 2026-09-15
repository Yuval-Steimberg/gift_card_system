import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { runReconciliation } from '@/lib/gift-cards/reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily reconciliation sweep: finds everything that was paid for and did not
 * arrive, and emails the owner — but ONLY when something is actually wrong, so
 * a quiet day is silent and an alert always means "go look".
 *
 * This is the safety net. Individual bugs will keep happening; this is what
 * makes sure a human hears about them the same day instead of from a customer.
 *
 * Auth matches /api/cron/deliver: the Bearer secret is enforced only when
 * CRON_SECRET is configured (a missing secret must never silently disable the
 * one job whose whole purpose is noticing problems), plus Vercel's own header.
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
  const result = await runReconciliation()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(request: Request) {
  return POST(request)
}
