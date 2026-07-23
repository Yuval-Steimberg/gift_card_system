import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { deliverDueJobs } from '@/lib/gift-cards/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Delivery worker. Processes due delivery jobs (immediate + scheduled). Meant to
 * be invoked by a scheduler (Vercel Cron / Supabase scheduled function / any
 * external cron) — NOT an in-process timer. Authorized via CRON_SECRET.
 */
export async function POST(request: Request) {
  const env = serverEnv()
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const result = await deliverDueJobs(new Date().toISOString(), 50)
  return NextResponse.json({ ok: true, ...result })
}

// Allow GET for platforms that trigger crons via GET, still secret-gated.
export async function GET(request: Request) {
  return POST(request)
}
